import { query, queryOne } from './db.js'
import { getWorkspace } from './store.js'
import { buildDailyCollectionJobTarget, buildDailyTargetFromBatch, previousUtcDay } from './swarm-daily.js'
import { authorizeSwarmBearer, extractBearerToken } from './swarm-token.js'

export async function authorizeSwarmRequestForWorkspace(request, workspaceSlug) {
  const workspace = await getWorkspace(workspaceSlug)
  if (!workspace) return { ok: false, status: 404, error: 'workspace not found' }
  const bearer = extractBearerToken(request)
  const ok = authorizeSwarmBearer({
    bearer,
    workspaceToken: workspace.swarm_token,
    globalToken: process.env.GTM_SWARM_TOKEN || '',
  })
  if (!ok) return { ok: false, status: 401, error: 'unauthorized' }
  return { ok: true, workspace }
}

export async function authorizeSwarmRequestForJob(request, jobId) {
  const row = await queryOne(
    `SELECT j.*, w.slug AS workspace_slug, w.swarm_token
     FROM swarm_jobs j
     JOIN workspaces w ON w.id = j.workspace_id
     WHERE j.id = $1`,
    [jobId]
  )
  if (!row) return { ok: false, status: 404, error: 'job not found' }
  const bearer = extractBearerToken(request)
  const ok = authorizeSwarmBearer({
    bearer,
    workspaceToken: row.swarm_token,
    globalToken: process.env.GTM_SWARM_TOKEN || '',
  })
  if (!ok) return { ok: false, status: 401, error: 'unauthorized' }
  return { ok: true, job: row }
}

async function requireWorkspace(slug) {
  const workspace = await getWorkspace(slug)
  if (!workspace) {
    const error = new Error('workspace not found')
    error.status = 404
    throw error
  }
  return workspace
}

async function upsertArtifact(workspaceId, batch, artifact) {
  return queryOne(
    `INSERT INTO swarm_artifacts (
       workspace_id, agent_key, node_id, platform, artifact_type, external_id,
       url, title, body, created_at, source_time, payload, updated_at
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
     ON CONFLICT (workspace_id, platform, artifact_type, external_id) DO UPDATE SET
       agent_key = EXCLUDED.agent_key,
       node_id = EXCLUDED.node_id,
       url = COALESCE(EXCLUDED.url, swarm_artifacts.url),
       title = COALESCE(EXCLUDED.title, swarm_artifacts.title),
       body = COALESCE(EXCLUDED.body, swarm_artifacts.body),
       source_time = COALESCE(EXCLUDED.source_time, swarm_artifacts.source_time),
       payload = swarm_artifacts.payload || EXCLUDED.payload,
       updated_at = now()
     RETURNING *`,
    [
      workspaceId,
      batch.agent_key,
      batch.node_id,
      artifact.platform,
      artifact.artifact_type,
      artifact.external_id,
      artifact.url,
      artifact.title,
      artifact.body,
      artifact.created_at,
      artifact.source_time,
      JSON.stringify(artifact.payload || {}),
    ]
  )
}

async function findArtifact(workspaceId, observation) {
  return queryOne(
    `SELECT * FROM swarm_artifacts
     WHERE workspace_id = $1 AND platform = $2 AND artifact_type = $3 AND external_id = $4`,
    [workspaceId, observation.platform, observation.artifact_type, observation.external_id]
  )
}

async function insertObservation(workspaceId, batch, artifactId, observation) {
  return queryOne(
    `INSERT INTO swarm_observations (
       workspace_id, artifact_id, agent_key, node_id, observed_at, metrics, payload
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (artifact_id, observed_at) DO UPDATE SET
       agent_key = EXCLUDED.agent_key,
       node_id = EXCLUDED.node_id,
       metrics = EXCLUDED.metrics,
       payload = EXCLUDED.payload
     RETURNING *`,
    [
      workspaceId,
      artifactId,
      batch.agent_key,
      batch.node_id,
      observation.observed_at,
      JSON.stringify(observation.metrics),
      JSON.stringify(observation.payload || {}),
    ]
  )
}

export async function ingestTelemetryBatch(batch) {
  const workspace = await requireWorkspace(batch.workspace)
  await upsertDailyTarget(buildDailyTargetFromBatch(batch))
  const artifactMap = new Map()
  let upserted = 0
  let inserted = 0

  for (const artifact of batch.artifacts) {
    const row = await upsertArtifact(workspace.id, batch, artifact)
    artifactMap.set(`${artifact.platform}:${artifact.artifact_type}:${artifact.external_id}`, row)
    upserted += 1
  }

  for (const observation of batch.observations) {
    const key = `${observation.platform}:${observation.artifact_type}:${observation.external_id}`
    const artifact = artifactMap.get(key) || await findArtifact(workspace.id, observation)
    if (!artifact) {
      const error = new Error(`observation references unknown artifact: ${key}`)
      error.status = 400
      throw error
    }
    await insertObservation(workspace.id, batch, artifact.id, observation)
    inserted += 1
  }

  return { ok: true, artifacts: { upserted }, observations: { inserted } }
}

export async function createSwarmJob(input) {
  const workspace = await requireWorkspace(input.workspace)
  return queryOne(
    `INSERT INTO swarm_jobs (workspace_id, kind, agent_key, platform, priority, target)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      workspace.id,
      input.kind || 'collect_observations',
      input.agent_key,
      input.platform || 'x',
      Number(input.priority || 0),
      JSON.stringify(input.target || {}),
    ]
  )
}

export async function upsertDailyTarget({ workspace, agent_key, platform, report_type = 'generic', multica_agent_name = null }) {
  const ws = await requireWorkspace(workspace)
  return queryOne(
    `INSERT INTO swarm_daily_targets (workspace_id, agent_key, platform, report_type, multica_agent_name)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (workspace_id, agent_key, platform) DO UPDATE SET
       report_type = EXCLUDED.report_type,
       multica_agent_name = COALESCE(EXCLUDED.multica_agent_name, swarm_daily_targets.multica_agent_name),
       enabled = true,
       updated_at = now()
     RETURNING *`,
    [ws.id, agent_key, platform, report_type, multica_agent_name]
  )
}

/**
 * @param {{ workspace?: string | null, platform?: string, report_type?: string }} [filters]
 */
export async function listDailyTargets({ workspace = null, platform = '', report_type = '' } = {}) {
  const params = []
  const where = ['t.enabled = true']
  if (workspace) {
    const ws = await requireWorkspace(workspace)
    params.push(ws.id)
    where.push(`t.workspace_id = $${params.length}`)
  }
  if (platform) {
    params.push(platform)
    where.push(`t.platform = $${params.length}`)
  }
  if (report_type) {
    params.push(report_type)
    where.push(`t.report_type = $${params.length}`)
  }
  return query(
    `SELECT t.*, w.slug AS workspace_slug
     FROM swarm_daily_targets t
     JOIN workspaces w ON w.id = t.workspace_id
     WHERE ${where.join(' AND ')}
     ORDER BY w.slug, t.agent_key`,
    params
  )
}

export async function ensureDailyTargetsFromArtifacts({ workspace = null } = {}) {
  const params = []
  const where = ['a.platform IS NOT NULL', 'a.agent_key IS NOT NULL']
  if (workspace) {
    const ws = await requireWorkspace(workspace)
    params.push(ws.id)
    where.push(`a.workspace_id = $${params.length}`)
  }
  const rows = await query(
    `SELECT DISTINCT w.slug AS workspace, a.workspace_id, a.agent_key, a.platform,
            CASE WHEN a.platform = 'mcp' THEN 'mcp' ELSE 'generic' END AS report_type
     FROM swarm_artifacts a
     JOIN workspaces w ON w.id = a.workspace_id
     WHERE ${where.join(' AND ')}`,
    params
  )
  const targets = []
  for (const row of rows) {
    targets.push(await upsertDailyTarget(row))
  }
  return targets
}

/**
 * @param {{ workspace?: string | null, platform?: string, report_type?: string, limit?: number }} [filters]
 */
export async function listDailyRuns({ workspace = null, platform = '', report_type = '', limit = 30 } = {}) {
  const params = []
  const where = ['1=1']
  if (workspace) {
    const ws = await requireWorkspace(workspace)
    params.push(ws.id)
    where.push(`r.workspace_id = $${params.length}`)
  }
  if (platform) {
    params.push(platform)
    where.push(`t.platform = $${params.length}`)
  }
  if (report_type) {
    params.push(report_type)
    where.push(`t.report_type = $${params.length}`)
  }
  params.push(limit)
  return query(
    `SELECT r.*, t.agent_key, t.platform, t.report_type, w.slug AS workspace_slug
     FROM swarm_daily_runs r
     JOIN swarm_daily_targets t ON t.id = r.target_id
     JOIN workspaces w ON w.id = r.workspace_id
     WHERE ${where.join(' AND ')}
     ORDER BY r.day DESC, t.agent_key
     LIMIT $${params.length}`,
    params
  )
}

export async function createDailyRunForTarget(target, day = previousUtcDay()) {
  const jobTarget = { day, target, runId: null }
  const run = await queryOne(
    `INSERT INTO swarm_daily_runs (workspace_id, target_id, day, status)
     VALUES ($1,$2,$3,'queued')
     ON CONFLICT (target_id, day) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [target.workspace_id, target.id, day]
  )
  if (run.job_id) return { run, job: null }
  const job = await queryOne(
    `INSERT INTO swarm_jobs (workspace_id, kind, agent_key, platform, priority, target)
     VALUES ($1,'collect_daily_telemetry',$2,$3,10,$4)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      target.workspace_id,
      target.agent_key,
      target.platform,
      JSON.stringify(buildDailyCollectionJobTarget({ ...jobTarget, runId: run.id })),
    ]
  )
  if (job) {
    await queryOne(
      `UPDATE swarm_daily_runs SET job_id = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [job.id, run.id]
    )
    await dispatchDailyRunToMultica({ target, day, runId: run.id, jobId: job.id }).catch(e => {
      console.warn('[swarm-daily] multica dispatch skipped:', e.message)
    })
  }
  return { run, job }
}

async function dispatchDailyRunToMultica({ target, day, runId, jobId }) {
  const { hasMultica, getWorkspaceBySlug, findWorkspaceAgent, getOrCreateGTMUser, createIssue, dispatchAgentTask } = await import('./multica-db.js')
  if (!hasMultica()) return null
  const workspace = await getWorkspaceBySlug(target.workspace_slug)
  if (!workspace) return null
  const agent = await findWorkspaceAgent(target.workspace_slug, [
    target.multica_agent_name,
    target.agent_key,
    target.agent_key.replace(/-/g, ' '),
  ])
  if (!agent?.runtime_id) return null

  const botId = await getOrCreateGTMUser(workspace.id)
  const issueId = await createIssue(workspace.id, {
    title: `[Telemetry] ${target.agent_key} ${day}`,
    description: [
      '## GTM Swarm Daily Telemetry Collection',
      '',
      `Workspace: ${target.workspace_slug}`,
      `Agent key: ${target.agent_key}`,
      `Platform: ${target.platform}`,
      `Report type: ${target.report_type}`,
      `Day: ${day}`,
      `Swarm job id: ${jobId}`,
      `Daily run id: ${runId}`,
      '',
      'Collect the daily telemetry summary for this day and POST it to GTM Swarm using the workspace swarm token.',
      'Use platform/artifact_type conventions from the GTM Swarm telemetry contract.',
    ].join('\n'),
    status: 'in_progress',
    priority: 'medium',
    creatorId: botId,
    assigneeId: agent.id,
  })
  const taskId = await dispatchAgentTask(agent.id, agent.runtime_id, issueId, {
    triggerSummary: `Collect ${target.report_type} telemetry for ${target.agent_key} on ${day}`,
    priority: 3,
  })
  await query(
    `UPDATE swarm_daily_runs
     SET missing_reason = COALESCE(missing_reason, '') || $1,
         updated_at = now()
     WHERE id = $2`,
    [`multica_issue=${issueId}; multica_task=${taskId}; `, runId]
  )
  return { issueId, taskId }
}

export async function createDailyRuns({ day = previousUtcDay(), workspace = null } = {}) {
  await ensureDailyTargetsFromArtifacts({ workspace })
  const targets = await listDailyTargets({ workspace })
  const created = []
  for (const target of targets) {
    created.push(await createDailyRunForTarget(target, day))
  }
  return created
}

export async function markMissingDailyRuns({ day = previousUtcDay(), reason = 'agent did not complete before deadline' } = {}) {
  return query(
    `UPDATE swarm_daily_runs
     SET status = 'missing', missing_reason = $1, updated_at = now()
     WHERE day = $2 AND status IN ('queued', 'leased')
     RETURNING *`,
    [reason, day]
  )
}

export async function leaseSwarmJob({ workspace, node_id, agent_key, lease_seconds = 300 }) {
  const ws = await requireWorkspace(workspace)
  const seconds = Math.max(30, Math.min(Number(lease_seconds || 300), 3600))
  const row = await queryOne(
    `WITH candidate AS (
       SELECT id FROM swarm_jobs
       WHERE workspace_id = $1
         AND agent_key = $2
         AND (
           status = 'queued'
           OR (status = 'leased' AND lease_expires_at < now())
         )
       ORDER BY priority DESC, created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE swarm_jobs j SET
       status = 'leased',
       lease_node_id = $3,
       lease_expires_at = now() + ($4::text || ' seconds')::interval,
       attempts = attempts + 1,
       updated_at = now()
     FROM candidate
     WHERE j.id = candidate.id
     RETURNING j.*`,
    [ws.id, agent_key, node_id, seconds]
  )
  if (!row) return null
  await query(
    `UPDATE swarm_daily_runs SET status = 'leased', updated_at = now()
     WHERE job_id = $1 AND status = 'queued'`,
    [row.id]
  )
  return {
    id: row.id,
    kind: row.kind,
    workspace,
    agent_key: row.agent_key,
    platform: row.platform,
    target: row.target || {},
    lease_expires_at: row.lease_expires_at,
  }
}

export async function completeSwarmJob(id, completion) {
  if (completion.batch) await ingestTelemetryBatch(completion.batch)
  if (completion.status === 'failed') {
    const job = await queryOne(
      `UPDATE swarm_jobs SET status = 'failed', result = $1, error = $2, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [JSON.stringify({ summary: completion.summary || '' }), completion.error || completion.summary || 'failed', id]
    )
    await query(
      `UPDATE swarm_daily_runs SET status = 'failed', missing_reason = $1, updated_at = now()
       WHERE job_id = $2`,
      [completion.error || completion.summary || 'failed', id]
    )
    return job
  }
  const job = await queryOne(
    `UPDATE swarm_jobs SET status = 'completed', result = $1, error = NULL, updated_at = now()
     WHERE id = $2 RETURNING *`,
    [JSON.stringify({ summary: completion.summary || '', batch_ingested: Boolean(completion.batch) }), id]
  )
  await query(
    `UPDATE swarm_daily_runs SET status = 'completed', completed_at = now(), missing_reason = NULL, updated_at = now()
     WHERE job_id = $1`,
    [id]
  )
  return job
}

function agentFilterSql(agentKey, nextIndex) {
  return agentKey ? { sql: ` AND a.agent_key = $${nextIndex}`, params: [agentKey] } : { sql: '', params: [] }
}

export async function countArtifactsByType({ workspace, agent_key = '', platform = 'x', from, to }) {
  const ws = await requireWorkspace(workspace)
  const agentFilter = agentFilterSql(agent_key, 5)
  const rows = await query(
    `SELECT artifact_type, COUNT(*)::int AS count
     FROM swarm_artifacts a
     WHERE workspace_id = $1 AND platform = $2 AND created_at >= $3 AND created_at <= $4${agentFilter.sql}
     GROUP BY artifact_type`,
    [ws.id, platform, from, to, ...agentFilter.params]
  )
  return Object.fromEntries(rows.map(row => [row.artifact_type, Number(row.count)]))
}

function metricJsonBuild(metrics, sourceAlias = 'latest') {
  return `jsonb_build_object(${metrics.map(metric => `'${metric}', COALESCE((${sourceAlias}.metrics->>'${metric}')::numeric, 0)`).join(', ')})`
}

export async function latestMetricLeaderboard({ workspace, agent_key = '', platform = 'x', artifact_type, metrics = ['views'], limit = 20 }) {
  const ws = await requireWorkspace(workspace)
  const sortMetric = metrics[0]
  const agentFilter = agentFilterSql(agent_key, 6)
  const rows = await query(
    `SELECT a.id AS artifact_id, a.external_id, a.url, a.title, a.body, latest.observed_at,
            ${metricJsonBuild(metrics, 'latest')} AS metrics
     FROM swarm_artifacts a
     JOIN LATERAL (
       SELECT observed_at, metrics
       FROM swarm_observations o
       WHERE o.artifact_id = a.id
       ORDER BY observed_at DESC
       LIMIT 1
     ) latest ON true
     WHERE a.workspace_id = $1 AND a.platform = $2 AND a.artifact_type = $3${agentFilter.sql}
     ORDER BY COALESCE((latest.metrics->>$4)::numeric, 0) DESC, latest.observed_at DESC
     LIMIT $5`,
    [ws.id, platform, artifact_type, sortMetric, limit, ...agentFilter.params]
  )
  return rows
}

export async function metricDeltaLeaderboard({ workspace, agent_key = '', platform = 'x', artifact_type, metrics = ['views'], from, to, limit = 20 }) {
  const ws = await requireWorkspace(workspace)
  const sortMetric = metrics[0]
  const agentFilter = agentFilterSql(agent_key, 8)
  const rows = await query(
    `SELECT a.id AS artifact_id, a.external_id, a.url, a.title, a.body,
            current_obs.observed_at AS current_observed_at,
            baseline_obs.observed_at AS baseline_observed_at,
            jsonb_build_object(${metrics.map(metric => `'${metric}', COALESCE((current_obs.metrics->>'${metric}')::numeric, 0)`).join(', ')}) AS current,
            jsonb_build_object(${metrics.map(metric => `'${metric}', COALESCE((baseline_obs.metrics->>'${metric}')::numeric, 0)`).join(', ')}) AS baseline,
            jsonb_build_object(${metrics.map(metric => `'${metric}', COALESCE((current_obs.metrics->>'${metric}')::numeric, 0) - COALESCE((baseline_obs.metrics->>'${metric}')::numeric, 0)`).join(', ')}) AS delta
     FROM swarm_artifacts a
     JOIN LATERAL (
       SELECT observed_at, metrics
       FROM swarm_observations o
       WHERE o.artifact_id = a.id AND o.observed_at <= $5
       ORDER BY observed_at DESC
       LIMIT 1
     ) current_obs ON true
     LEFT JOIN LATERAL (
       SELECT observed_at, metrics
       FROM swarm_observations o
       WHERE o.artifact_id = a.id AND o.observed_at < $4
       ORDER BY observed_at DESC
       LIMIT 1
     ) baseline_obs ON true
     WHERE a.workspace_id = $1 AND a.platform = $2 AND a.artifact_type = $3${agentFilter.sql}
     ORDER BY COALESCE((current_obs.metrics->>$6)::numeric, 0) - COALESCE((baseline_obs.metrics->>$6)::numeric, 0) DESC,
              current_obs.observed_at DESC
     LIMIT $7`,
    [ws.id, platform, artifact_type, from, to, sortMetric, limit, ...agentFilter.params]
  )
  return rows
}

function mcpBaseWhere(agentKey, startIndex = 4) {
  return agentKey ? { sql: ` AND a.agent_key = $${startIndex}`, params: [agentKey] } : { sql: '', params: [] }
}

export async function mcpSummary({ workspace, agent_key = '', from, to }) {
  const ws = await requireWorkspace(workspace)
  const agentFilter = mcpBaseWhere(agent_key, 4)
  return queryOne(
    `SELECT
       COUNT(*)::int AS total_calls,
       COUNT(*) FILTER (WHERE a.payload->>'status' = 'error')::int AS error_calls,
       COUNT(*) FILTER (WHERE a.payload->>'business_success' = 'true')::int AS business_success_calls,
       COUNT(DISTINCT NULLIF(a.payload->>'client_instance_id', ''))::int AS active_client_instances
     FROM swarm_artifacts a
     WHERE a.workspace_id = $1
       AND a.platform = 'mcp'
       AND a.artifact_type = 'mcp_tool_call'
       AND a.created_at >= $2
       AND a.created_at <= $3${agentFilter.sql}`,
    [ws.id, from, to, ...agentFilter.params]
  )
}

export async function mcpGroupedCounts({ workspace, agent_key = '', from, to }) {
  const ws = await requireWorkspace(workspace)
  const agentFilter = mcpBaseWhere(agent_key, 4)
  const params = [ws.id, from, to, ...agentFilter.params]
  const where = `a.workspace_id = $1
    AND a.platform = 'mcp'
    AND a.artifact_type = 'mcp_tool_call'
    AND a.created_at >= $2
    AND a.created_at <= $3${agentFilter.sql}`

  const [callsByTool, errorsByTool, errorTypes, sourceCatalogs, topClients, businessSuccessByTool, routeHealth] = await Promise.all([
    query(`SELECT COALESCE(NULLIF(a.payload->>'tool', ''), 'unknown') AS label, COUNT(*)::int AS count
           FROM swarm_artifacts a WHERE ${where} GROUP BY label ORDER BY count DESC`, params),
    query(`SELECT COALESCE(NULLIF(a.payload->>'tool', ''), 'unknown') AS label,
                  COUNT(*) FILTER (WHERE a.payload->>'status' = 'error')::int AS count,
                  COUNT(*)::int AS total,
                  CASE WHEN COUNT(*) = 0 THEN 0 ELSE COUNT(*) FILTER (WHERE a.payload->>'status' = 'error')::float / COUNT(*) END AS rate
           FROM swarm_artifacts a WHERE ${where} GROUP BY label ORDER BY rate DESC, count DESC`, params),
    query(`SELECT COALESCE(NULLIF(a.payload->>'error_type', ''), 'none') AS label, COUNT(*)::int AS count
           FROM swarm_artifacts a WHERE ${where} AND COALESCE(a.payload->>'error_type', '') <> ''
           GROUP BY label ORDER BY count DESC`, params),
    query(`SELECT COALESCE(NULLIF(a.payload->>'source_catalog', ''), 'unknown') AS label, COUNT(*)::int AS count
           FROM swarm_artifacts a WHERE ${where} GROUP BY label ORDER BY count DESC`, params),
    query(`SELECT COALESCE(NULLIF(a.payload->>'client', ''), 'unknown') AS label, COUNT(*)::int AS count
           FROM swarm_artifacts a WHERE ${where} GROUP BY label ORDER BY count DESC LIMIT 20`, params),
    query(`SELECT COALESCE(NULLIF(a.payload->>'tool', ''), 'unknown') AS label,
                  COUNT(*) FILTER (WHERE a.payload->>'business_success' = 'true')::int AS count,
                  COUNT(*)::int AS total,
                  CASE WHEN COUNT(*) = 0 THEN 0 ELSE COUNT(*) FILTER (WHERE a.payload->>'business_success' = 'true')::float / COUNT(*) END AS rate
           FROM swarm_artifacts a WHERE ${where} GROUP BY label ORDER BY rate DESC, total DESC`, params),
    query(`SELECT COALESCE(NULLIF(a.payload->>'route', ''), 'POST /mcp') AS label,
                  COUNT(*)::int AS requests,
                  COUNT(*) FILTER (WHERE (a.payload->>'http_status')::int BETWEEN 200 AND 299)::int AS http_2xx,
                  COUNT(*) FILTER (WHERE (a.payload->>'http_status')::int BETWEEN 400 AND 499)::int AS http_4xx,
                  COUNT(*) FILTER (WHERE (a.payload->>'http_status')::int >= 500)::int AS http_5xx
           FROM swarm_artifacts a WHERE ${where} GROUP BY label ORDER BY requests DESC`, params),
  ])

  return {
    calls_by_tool: callsByTool,
    errors_by_tool: errorsByTool,
    error_types: errorTypes,
    source_catalogs: sourceCatalogs,
    top_clients: topClients,
    business_success_by_tool: businessSuccessByTool,
    route_health: routeHealth,
  }
}

export async function mcpLatencyByTool({ workspace, agent_key = '', from, to }) {
  const ws = await requireWorkspace(workspace)
  const agentFilter = mcpBaseWhere(agent_key, 4)
  return query(
    `SELECT COALESCE(NULLIF(a.payload->>'tool', ''), 'unknown') AS tool,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (o.metrics->>'latency_ms')::numeric) AS p50_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY (o.metrics->>'latency_ms')::numeric) AS p95_ms
     FROM swarm_artifacts a
     JOIN swarm_observations o ON o.artifact_id = a.id
     WHERE a.workspace_id = $1
       AND a.platform = 'mcp'
       AND a.artifact_type = 'mcp_tool_call'
       AND a.created_at >= $2
       AND a.created_at <= $3
       AND o.metrics ? 'latency_ms'${agentFilter.sql}
     GROUP BY tool
     ORDER BY p95_ms DESC`,
    [ws.id, from, to, ...agentFilter.params]
  )
}

export async function mcpCallTrend({ workspace, agent_key = '', from, to }) {
  const ws = await requireWorkspace(workspace)
  const agentFilter = mcpBaseWhere(agent_key, 4)
  return query(
    `SELECT date_trunc('hour', a.created_at) AS bucket, COUNT(*)::int AS calls
     FROM swarm_artifacts a
     WHERE a.workspace_id = $1
       AND a.platform = 'mcp'
       AND a.artifact_type = 'mcp_tool_call'
       AND a.created_at >= $2
       AND a.created_at <= $3${agentFilter.sql}
     GROUP BY bucket
     ORDER BY bucket ASC`,
    [ws.id, from, to, ...agentFilter.params]
  )
}

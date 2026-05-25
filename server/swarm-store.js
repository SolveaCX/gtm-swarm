import { query, queryOne } from './db.js'
import { getWorkspace } from './store.js'
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
    return queryOne(
      `UPDATE swarm_jobs SET status = 'failed', result = $1, error = $2, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [JSON.stringify({ summary: completion.summary || '' }), completion.error || completion.summary || 'failed', id]
    )
  }
  return queryOne(
    `UPDATE swarm_jobs SET status = 'completed', result = $1, error = NULL, updated_at = now()
     WHERE id = $2 RETURNING *`,
    [JSON.stringify({ summary: completion.summary || '', batch_ingested: Boolean(completion.batch) }), id]
  )
}

export async function countArtifactsByType({ workspace, platform = 'x', from, to }) {
  const ws = await requireWorkspace(workspace)
  const rows = await query(
    `SELECT artifact_type, COUNT(*)::int AS count
     FROM swarm_artifacts
     WHERE workspace_id = $1 AND platform = $2 AND created_at >= $3 AND created_at <= $4
     GROUP BY artifact_type`,
    [ws.id, platform, from, to]
  )
  return Object.fromEntries(rows.map(row => [row.artifact_type, Number(row.count)]))
}

function metricJsonBuild(metrics, sourceAlias = 'latest') {
  return `jsonb_build_object(${metrics.map(metric => `'${metric}', COALESCE((${sourceAlias}.metrics->>'${metric}')::numeric, 0)`).join(', ')})`
}

export async function latestMetricLeaderboard({ workspace, platform = 'x', artifact_type, metrics = ['views'], limit = 20 }) {
  const ws = await requireWorkspace(workspace)
  const sortMetric = metrics[0]
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
     WHERE a.workspace_id = $1 AND a.platform = $2 AND a.artifact_type = $3
     ORDER BY COALESCE((latest.metrics->>$4)::numeric, 0) DESC, latest.observed_at DESC
     LIMIT $5`,
    [ws.id, platform, artifact_type, sortMetric, limit]
  )
  return rows
}

export async function metricDeltaLeaderboard({ workspace, platform = 'x', artifact_type, metrics = ['views'], from, to, limit = 20 }) {
  const ws = await requireWorkspace(workspace)
  const sortMetric = metrics[0]
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
     WHERE a.workspace_id = $1 AND a.platform = $2 AND a.artifact_type = $3
     ORDER BY COALESCE((current_obs.metrics->>$6)::numeric, 0) - COALESCE((baseline_obs.metrics->>$6)::numeric, 0) DESC,
              current_obs.observed_at DESC
     LIMIT $7`,
    [ws.id, platform, artifact_type, from, to, sortMetric, limit]
  )
  return rows
}

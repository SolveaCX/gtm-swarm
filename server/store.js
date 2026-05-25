// server/store.js
import { query, queryOne } from './db.js'
import { generateSwarmToken } from './swarm-token.js'

// ── Workspaces ──────────────────────────────────────────────────────────────

export async function listWorkspaces() {
  return query('SELECT * FROM workspaces ORDER BY created_at DESC')
}

export async function ensureWorkspaceSwarmTokens() {
  return query(
    `UPDATE workspaces
     SET swarm_token = 'gtms_' || encode(gen_random_bytes(32), 'hex'),
         updated_at = now()
     WHERE swarm_token IS NULL
     RETURNING slug, swarm_token`
  )
}

export async function getWorkspace(slug) {
  return queryOne('SELECT * FROM workspaces WHERE slug = $1', [slug])
}

export async function createWorkspace({ slug, name, lifecycle_state = 'onboarding', urls = {}, project_config = {}, engine_overrides = {} }) {
  return queryOne(
    `INSERT INTO workspaces (slug, name, lifecycle_state, urls, project_config, engine_overrides, swarm_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [slug, name, lifecycle_state, JSON.stringify(urls), JSON.stringify(project_config), JSON.stringify(engine_overrides), generateSwarmToken()]
  )
}

export async function ensureWorkspaceSwarmToken(slug) {
  const existing = await getWorkspace(slug)
  if (!existing) return null
  if (existing.swarm_token) return existing
  const updated = await queryOne(
    `UPDATE workspaces SET swarm_token = $1, updated_at = now()
     WHERE slug = $2 AND swarm_token IS NULL
     RETURNING *`,
    [generateSwarmToken(), slug]
  )
  return updated || getWorkspace(slug)
}

export async function updateWorkspace(slug, patch) {
  const fields = []
  const vals = []
  let i = 1
  const allowed = ['name', 'lifecycle_state', 'urls', 'project_config', 'engine_overrides']
  for (const k of allowed) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = $${i++}`)
      vals.push(typeof patch[k] === 'object' ? JSON.stringify(patch[k]) : patch[k])
    }
  }
  if (!fields.length) return getWorkspace(slug)
  fields.push(`updated_at = now()`)
  vals.push(slug)
  return queryOne(`UPDATE workspaces SET ${fields.join(', ')} WHERE slug = $${i} RETURNING *`, vals)
}

export async function bindMulticaWorkspace(slug, multicaSlug) {
  return queryOne(
    `UPDATE workspaces SET multica_workspace_slug = $1, updated_at = now()
     WHERE slug = $2 AND multica_workspace_slug IS NULL RETURNING *`,
    [multicaSlug, slug]
  )
}

export async function saveWorkspaceCIAResult(slug, synthesis) {
  return queryOne(
    `UPDATE workspaces SET cia_result = $1, updated_at = now() WHERE slug = $2 RETURNING *`,
    [JSON.stringify(synthesis), slug]
  )
}

// ── People ───────────────────────────────────────────────────────────────────

export async function listPeople() {
  return query('SELECT * FROM people WHERE active = true ORDER BY handle')
}

export async function getPerson(id) {
  return queryOne('SELECT * FROM people WHERE id = $1', [id])
}

export async function createPerson({ handle, name, role, channels = [], max_workload = 3 }) {
  return queryOne(
    `INSERT INTO people (handle, name, role, channels, max_workload)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [handle, name, role, JSON.stringify(channels), max_workload]
  )
}

export async function updatePerson(id, patch) {
  const fields = []
  const vals = []
  let i = 1
  for (const k of ['name', 'role', 'channels', 'max_workload', 'active']) {
    if (patch[k] !== undefined) {
      fields.push(`${k} = $${i++}`)
      vals.push(Array.isArray(patch[k]) ? JSON.stringify(patch[k]) : patch[k])
    }
  }
  if (!fields.length) return getPerson(id)
  vals.push(id)
  return queryOne(`UPDATE people SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`, vals)
}

// ── Agents ───────────────────────────────────────────────────────────────────

export async function listAgentsForWorkspace(workspaceId) {
  return query(
    `SELECT a.*, cp.review_checklist, cp.content_template, cp.dashboard_widgets, cp.kpi_defaults
     FROM agents a
     LEFT JOIN channel_profiles cp ON a.channel_profile_id = cp.id
     WHERE a.workspace_id = $1 ORDER BY a.channel`,
    [workspaceId]
  )
}

export async function createAgent({ workspace_id, channel, config = {}, metrics = {} }) {
  const cp = await queryOne('SELECT id FROM channel_profiles WHERE channel = $1', [channel])
  return queryOne(
    `INSERT INTO agents (workspace_id, channel, channel_profile_id, config, metrics)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [workspace_id, channel, cp?.id || null, JSON.stringify(config), JSON.stringify(metrics)]
  )
}

export async function updateAgentMetrics(agentId, metrics) {
  return queryOne(
    'UPDATE agents SET metrics = metrics || $1::jsonb WHERE id = $2 RETURNING *',
    [JSON.stringify(metrics), agentId]
  )
}

// ── Assignments ──────────────────────────────────────────────────────────────

export async function getAssignments(agentId) {
  return query(
    `SELECT aa.role, p.* FROM agent_assignments aa JOIN people p ON aa.person_id = p.id WHERE aa.agent_id = $1`,
    [agentId]
  )
}

export async function assign(agentId, personId, role) {
  return queryOne(
    `INSERT INTO agent_assignments (agent_id, person_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (agent_id, role) DO UPDATE SET person_id = EXCLUDED.person_id RETURNING *`,
    [agentId, personId, role]
  )
}

export async function autoAssignPeople(agentId, channel) {
  const candidates = await query(
    `SELECT p.id, p.role,
       COUNT(aa.agent_id) AS current_load
     FROM people p
     LEFT JOIN agent_assignments aa ON aa.person_id = p.id
     WHERE p.active = true
       AND p.channels @> $1::jsonb
     GROUP BY p.id
     HAVING COUNT(aa.agent_id) < p.max_workload
     ORDER BY current_load ASC`,
    [JSON.stringify([channel])]
  )
  const builder = candidates.find(c => c.role === 'builder')
  const reviewer = candidates.find(c => c.role === 'reviewer')
  if (builder) await assign(agentId, builder.id, 'builder')
  if (reviewer) await assign(agentId, reviewer.id, 'reviewer')
  return { builder: builder || null, reviewer: reviewer || null }
}

// ── ContentOS State ──────────────────────────────────────────────────────────

export async function getContentOSState(workspaceId) {
  return queryOne('SELECT * FROM contentos_states WHERE workspace_id = $1', [workspaceId])
}

export async function saveContentOSState(workspaceId, { current_step, steps }) {
  return queryOne(
    `INSERT INTO contentos_states (workspace_id, current_step, steps, last_updated)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (workspace_id) DO UPDATE SET
       current_step = EXCLUDED.current_step,
       steps = EXCLUDED.steps,
       last_updated = now()
     RETURNING *`,
    [workspaceId, current_step, JSON.stringify(steps)]
  )
}

// ── Strategy Docs ────────────────────────────────────────────────────────────

export async function getStrategyDoc(workspaceId, stepKey) {
  return queryOne(
    'SELECT * FROM strategy_docs WHERE workspace_id = $1 AND step_key = $2 ORDER BY version DESC LIMIT 1',
    [workspaceId, stepKey]
  )
}

export async function saveStrategyDoc(workspaceId, stepKey, content, usage = null) {
  const existing = await getStrategyDoc(workspaceId, stepKey)
  const version = existing ? existing.version + 1 : 1
  return queryOne(
    `INSERT INTO strategy_docs (workspace_id, step_key, version, content, usage)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [workspaceId, stepKey, version, content, usage ? JSON.stringify(usage) : null]
  )
}

// ── Engine Files ─────────────────────────────────────────────────────────────

export async function getEngineFile(workspaceId, filePath) {
  // Tier 1: product-specific
  const row = await queryOne(
    'SELECT content FROM engines WHERE workspace_id = $1 AND file_path = $2',
    [workspaceId, filePath]
  )
  if (row) return row.content
  // Tier 2: base skeleton (workspace_id IS NULL)
  const base = await queryOne(
    'SELECT content FROM engines WHERE workspace_id IS NULL AND file_path = $1',
    [filePath]
  )
  return base?.content || null
}

export async function upsertEngineFile(workspaceId, filePath, content) {
  return queryOne(
    `INSERT INTO engines (workspace_id, file_path, content) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, file_path) DO UPDATE SET content = EXCLUDED.content RETURNING *`,
    [workspaceId, filePath, content]
  )
}

export async function listEngineFiles(workspaceId) {
  return query(
    `SELECT file_path, LENGTH(content) AS size FROM engines
     WHERE workspace_id = $1 OR workspace_id IS NULL
     ORDER BY file_path`,
    [workspaceId]
  )
}

// ── Content Items ─────────────────────────────────────────────────────────────

export async function listContentItems(workspaceId, state = null) {
  if (state) {
    return query(
      'SELECT * FROM content_items WHERE workspace_id = $1 AND state = $2 ORDER BY mtime DESC',
      [workspaceId, state]
    )
  }
  return query('SELECT * FROM content_items WHERE workspace_id = $1 ORDER BY mtime DESC', [workspaceId])
}

export async function createContentItem({ workspace_id, agent_id, state = 'new-idea', frontmatter = {}, body = '' }) {
  return queryOne(
    `INSERT INTO content_items (workspace_id, agent_id, state, frontmatter, body)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [workspace_id, agent_id, state, JSON.stringify(frontmatter), body]
  )
}

export async function updateContentItemState(id, state) {
  return queryOne(
    'UPDATE content_items SET state = $1, mtime = now() WHERE id = $2 RETURNING *',
    [state, id]
  )
}

export async function upsertReviewResult(multica_issue_id, { workspace_id, state, frontmatter }) {
  const existing = await queryOne(
    `SELECT id FROM content_items WHERE frontmatter->>'multica_issue_id' = $1`,
    [multica_issue_id]
  )
  const fm = JSON.stringify({ ...frontmatter, multica_issue_id })
  if (existing) {
    return queryOne(
      'UPDATE content_items SET state = $1, frontmatter = $2, mtime = now() WHERE id = $3 RETURNING *',
      [state, fm, existing.id]
    )
  }
  return queryOne(
    'INSERT INTO content_items (workspace_id, state, frontmatter) VALUES ($1, $2, $3) RETURNING *',
    [workspace_id, state, fm]
  )
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

export async function auditLog(workspaceId, actor, action, detail = {}) {
  return query(
    'INSERT INTO audit_log (workspace_id, actor, action, detail) VALUES ($1, $2, $3, $4)',
    [workspaceId, actor, action, JSON.stringify(detail)]
  )
}

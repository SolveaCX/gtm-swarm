import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const store = readFileSync(path.join(process.cwd(), 'server/swarm-store.js'), 'utf-8')

test('daily target upserts preserve custom reports when generic telemetry arrives later', () => {
  assert.match(
    store,
    /WHEN swarm_daily_targets\.report_type = 'custom'\s+AND \$\d+ = 'generic'\s+THEN swarm_daily_targets\.report_type/s
  )
})

test('daily target upserts use the deployed agent_key constraint for compatibility', () => {
  assert.match(store, /UPDATE swarm_daily_targets/)
  assert.match(store, /WHERE workspace_id = \$\d+ AND agent_key = \$\d+ AND platform = \$\d+/)
  assert.match(store, /INSERT INTO swarm_daily_targets/)
  assert.match(store, /if \(e\.code === '23505'/)
  assert.match(store, /SET agent_id = \$\d+/)
})

test('daily target listing surfaces custom report targets from dashboard specs', () => {
  assert.match(store, /LEFT JOIN swarm_dashboard_specs s/s)
  assert.match(store, /CASE WHEN s\.id IS NOT NULL THEN 'custom' ELSE t\.report_type END AS report_type/s)
  assert.match(store, /COALESCE\(s\.updated_at, t\.updated_at\) DESC/s)
})

test('daily target listing hides duplicate collector custom specs when a real agent has the same widgets', () => {
  assert.match(store, /t\.agent_key = 'mcp-daily-data'/)
  assert.match(store, /t\.agent_id = 'mcp-daily-data'/)
  assert.match(store, /t2\.agent_key <> 'mcp-daily-data'/s)
  assert.match(store, /CASE WHEN s2\.id IS NOT NULL THEN 'custom' ELSE t2\.report_type END = 'custom'/s)
})

test('dashboard spec reads fall back from agent_id to agent_key for legacy rows', () => {
  assert.match(store, /if \(agent_id\)/)
  assert.match(store, /if \(row\) return row/)
  assert.match(store, /if \(agent_key\)/)
  assert.match(store, /workspace_id = \$1', 'report_type = \$2', 'agent_key = \$3'/)
})

test('dashboard spec upserts migrate legacy agent_key rows onto the current agent_id', () => {
  assert.match(store, /UPDATE swarm_dashboard_specs\s+SET agent_key = \$3,/s)
  assert.match(store, /SET agent_id = \$2,\s+agent_key = \$3,/s)
  assert.match(store, /WHERE workspace_id = \$1 AND agent_key = \$3 AND platform = \$4 AND report_type = \$5/s)
  assert.match(store, /INSERT INTO swarm_dashboard_specs/)
})

test('swarm storage records and filters report data by agent_id', () => {
  assert.match(store, /agent_id/)
  assert.match(store, /batch\.agent_id/)
  assert.match(store, /input\.agent_id/)
  assert.match(store, /agentFilterSql\(agent_id, agent_key,/)
  assert.match(store, /a\.agent_id = \$\$\{nextIndex\}/)
})

test('swarm ingest can replace one day of report data before accepting corrected telemetry', () => {
  assert.match(store, /async function replaceTelemetryDay/)
  assert.match(store, /batch\.correction\?\.mode === 'replace_day'/)
  assert.match(store, /DELETE FROM swarm_observations o/s)
  assert.match(store, /DELETE FROM swarm_artifacts a/s)
  assert.match(store, /o\.observed_at >= \$\d+/)
  assert.match(store, /a\.created_at >= \$\d+/)
  assert.match(store, /platform = \$\d+/)
  assert.match(store, /artifact_type = \$\d+/)
})

test('job completion ingests telemetry into the job workspace instead of trusting batch workspace', () => {
  assert.match(store, /w\.slug AS workspace_slug/)
  assert.match(store, /completion\.batch/)
  assert.match(store, /workspace: job\.workspace_slug/)
})

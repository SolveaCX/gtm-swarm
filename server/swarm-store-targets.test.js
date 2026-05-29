import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const store = readFileSync(path.join(process.cwd(), 'server/swarm-store.js'), 'utf-8')

test('daily target upserts preserve custom reports when generic telemetry arrives later', () => {
  assert.match(
    store,
    /WHEN swarm_daily_targets\.report_type = 'custom'\s+AND EXCLUDED\.report_type = 'generic'\s+THEN swarm_daily_targets\.report_type/s
  )
})

test('daily target upserts use the deployed agent_key constraint for compatibility', () => {
  assert.match(store, /ON CONFLICT \(workspace_id, agent_key, platform\) DO UPDATE SET/)
  assert.match(store, /agent_id = EXCLUDED\.agent_id/)
})

test('daily target listing surfaces custom report targets from dashboard specs', () => {
  assert.match(store, /LEFT JOIN swarm_dashboard_specs s/s)
  assert.match(store, /CASE WHEN s\.id IS NOT NULL THEN 'custom' ELSE t\.report_type END AS report_type/s)
  assert.match(store, /COALESCE\(s\.updated_at, t\.updated_at\) DESC/s)
})

test('daily target listing hides duplicate collector custom specs when a real agent has the same widgets', () => {
  assert.match(store, /t\.agent_key IN \('mcp-daily-data'\)/)
  assert.match(store, /s2\.agent_id <> t\.agent_id/s)
  assert.match(store, /s2\.spec->'widgets' = s\.spec->'widgets'/s)
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

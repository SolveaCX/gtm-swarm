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

test('daily target listing surfaces custom report targets from dashboard specs', () => {
  assert.match(store, /LEFT JOIN swarm_dashboard_specs s/s)
  assert.match(store, /CASE WHEN s\.id IS NOT NULL THEN 'custom' ELSE t\.report_type END AS report_type/s)
  assert.match(store, /COALESCE\(s\.updated_at, t\.updated_at\) DESC/s)
})

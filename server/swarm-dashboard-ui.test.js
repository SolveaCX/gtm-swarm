import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test('swarm reports are selected by agent target, not by report type', () => {
  const page = readFileSync(path.join(process.cwd(), 'app/dashboard/[slug]/swarm/page.tsx'), 'utf-8')

  assert.match(page, /selectedTargetId/)
  assert.match(page, /qs\.set\('agent_id', agentId\)/)
  assert.match(page, /selectedTarget\?\.report_type/)
  assert.match(page, /Agent/)
  assert.match(page, /start\.setDate\(now\.getDate\(\) - 7\)/)
  assert.match(page, /showOnboarding = noTargets/)
  assert.match(page, /showNoData/)
  assert.match(page, /function normalizeDateOnlyInput\(value: string\)/)
  assert.match(page, /const latestRunDay = normalizeDateOnlyInput\(latestRun\?\.day \|\| ''\)/)
  assert.match(page, /qs\.set\('date', normalizedSelectedDate\)/)
  assert.doesNotMatch(page, /setReportType/)
  assert.doesNotMatch(page, /<option value="custom">Custom agent reports<\/option>/)
  assert.doesNotMatch(page, /<option value="mcp">MCP telemetry<\/option>/)
  assert.doesNotMatch(page, /<option value="x">X posts\/replies<\/option>/)
})

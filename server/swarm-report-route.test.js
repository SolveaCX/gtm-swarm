import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const route = readFileSync(path.join(process.cwd(), 'app/api/swarm/report/route.ts'), 'utf-8')

test('custom report rendering prefers requested agent identity when a legacy dashboard spec row is reused', () => {
  assert.match(route, /agent_id: agent_id \|\| specRow\.agent_id/)
  assert.match(route, /agent_key: agent_key \|\| specRow\.agent_key/)
  assert.match(route, /platform: platform \|\| specRow\.platform/)
})

test('custom reports can resolve a single selected day into a report window', () => {
  assert.match(route, /const date = params\.get\('date'\) \|\| ''/)
  assert.match(route, /date must be YYYY-MM-DD/)
  assert.doesNotMatch(route, /else if \(report_type === 'custom'\)/)
})

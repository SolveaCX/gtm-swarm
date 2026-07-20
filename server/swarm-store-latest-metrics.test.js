import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(process.cwd(), 'server/swarm-store.js'), 'utf8')

function exportedFunction(name) {
  const start = source.indexOf(`export async function ${name}`)
  assert.notEqual(start, -1, `${name} must exist`)
  const next = source.indexOf('\nexport async function ', start + 1)
  return source.slice(start, next === -1 ? source.length : next)
}

test('latest metric sums select one in-range observation per artifact before summing', () => {
  const body = exportedFunction('latestMetricSum')
  assert.match(body, /SUM\(COALESCE\(\(latest\.metrics->>\$4\)::numeric, 0\)\)/)
  assert.match(body, /JOIN LATERAL[\s\S]*o\.artifact_id = a\.id/)
  assert.match(body, /o\.observed_at >= \$5/)
  assert.match(body, /o\.observed_at <= \$6/)
  assert.match(body, /ORDER BY o\.observed_at DESC, o\.id DESC\s+LIMIT 1/)
})

test('latest metric ratios divide summed components instead of aggregating campaign ratios', () => {
  const body = exportedFunction('latestMetricRatio')
  assert.match(body, /SUM\(COALESCE\(\(latest\.metrics->>\$4\)::numeric, 0\)\).*AS numerator/s)
  assert.match(body, /SUM\(COALESCE\(\(latest\.metrics->>\$5\)::numeric, 0\)\).*AS denominator/s)
  assert.match(body, /totals\.numerator \/ totals\.denominator \* \$8::numeric/)
  assert.doesNotMatch(body, /AVG\(/)
  assert.match(body, /o\.observed_at >= \$6/)
  assert.match(body, /o\.observed_at <= \$7/)
})

test('latest metric leaderboard excludes artifacts without an observation in the requested range', () => {
  const body = exportedFunction('latestMetricLeaderboard')
  assert.match(body, /JOIN LATERAL/)
  assert.match(body, /o\.observed_at >= \$4/)
  assert.match(body, /o\.observed_at <= \$5/)
  assert.match(body, /ORDER BY observed_at DESC, o\.id DESC\s+LIMIT 1/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMetricFlags } from './args.js'
import { validateTelemetryBatch } from './schema.js'

function telemetryBatch(metrics) {
  return {
    schema_version: 'swarm.telemetry.v1',
    workspace: 'example-workspace',
    agent_id: 'agent-runtime-123',
    agent_key: 'example-agent',
    node_id: 'local',
    artifacts: [],
    observations: [{
      platform: 'x',
      artifact_type: 'post',
      external_id: 'post-1',
      observed_at: '2026-07-20T00:00:00.000Z',
      metrics,
    }],
  }
}

test('metric flags accept server-compatible metric names', () => {
  const sixtyFourCharacters = `m${'a'.repeat(63)}`

  assert.deepEqual(
    parseMetricFlags(['views=12', 'revenue_usd=3.5', `${sixtyFourCharacters}=1`]),
    { views: 12, revenue_usd: 3.5, [sixtyFourCharacters]: 1 },
  )
})

test('metric flags reject names outside the server metric-name contract', () => {
  for (const name of ['Views', '1views', 'revenue.usd', 'revenue-usd', `m${'a'.repeat(64)}`]) {
    assert.throws(
      () => parseMetricFlags([`${name}=1`]),
      /invalid metric name.*\^\[a-z\]\[a-z0-9_\]/,
    )
  }
})

test('batch validation rejects unsafe metric names before sending', () => {
  const result = validateTelemetryBatch(telemetryBatch({ 'revenue.usd': 10 }))

  assert.equal(result.ok, false)
  assert.match(result.error, /observations\[0\]\.metrics\.revenue\.usd must match/)
})

test('batch validation accepts server-compatible metric names', () => {
  const result = validateTelemetryBatch(telemetryBatch({ impressions: 100, revenue_usd: 4.25 }))

  assert.equal(result.ok, true)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJobCompletion, validateTelemetryBatch } from './swarm-schema.js'

const validBatch = {
  schema_version: 'swarm.telemetry.v1',
  workspace: 'flatkey',
  agent_key: 'x-growth-agent',
  node_id: 'mac-mini-01',
  sent_at: '2026-05-25T09:30:00Z',
  artifacts: [
    {
      platform: 'x',
      artifact_type: 'post',
      external_id: '1794312345678900000',
      url: 'https://x.com/acme/status/1794312345678900000',
      created_at: '2026-05-25T08:10:00Z',
      payload: { account: '@acme' },
    },
  ],
  observations: [
    {
      platform: 'x',
      artifact_type: 'post',
      external_id: '1794312345678900000',
      observed_at: '2026-05-25T09:25:00Z',
      metrics: { views: 1834, replies: 12 },
    },
  ],
}

test('validates a complete telemetry batch', () => {
  const result = validateTelemetryBatch(validBatch)
  assert.equal(result.ok, true)
  assert.equal(result.batch.workspace, 'flatkey')
  assert.equal(result.batch.artifacts[0].platform, 'x')
  assert.equal(result.batch.observations[0].metrics.views, 1834)
})

test('rejects missing workspace', () => {
  const result = validateTelemetryBatch({ ...validBatch, workspace: '' })
  assert.equal(result.ok, false)
  assert.match(result.error, /workspace/)
})

test('rejects non-numeric metrics', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    observations: [{ ...validBatch.observations[0], metrics: { views: '1,834' } }],
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /views/)
})

test('validates failed job completion', () => {
  const result = validateJobCompletion({ status: 'failed', summary: 'Browser login expired.', error: 'x_session_expired' })
  assert.equal(result.ok, true)
  assert.equal(result.completion.status, 'failed')
  assert.equal(result.completion.error, 'x_session_expired')
})

test('validates completed job completion with batch', () => {
  const result = validateJobCompletion({ status: 'completed', summary: 'ok', batch: validBatch })
  assert.equal(result.ok, true)
  assert.equal(result.completion.batch.observations.length, 1)
})

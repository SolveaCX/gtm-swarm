import test from 'node:test'
import assert from 'node:assert/strict'
import { validateJobCompletion, validateTelemetryBatch } from './swarm-schema.js'

const validBatch = {
  schema_version: 'swarm.telemetry.v1',
  workspace: 'flatkey',
  agent_id: 'agent-runtime-123',
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
  assert.equal(result.batch.agent_id, 'agent-runtime-123')
  assert.equal(result.batch.artifacts[0].platform, 'x')
  assert.equal(result.batch.observations[0].metrics.views, 1834)
})

test('validates telemetry correction requests for replacing one UTC day', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    correction: {
      day: '2026-05-25',
      mode: 'replace_day',
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.batch.correction, {
    day: '2026-05-25',
    mode: 'replace_day',
  })
})

test('rejects telemetry correction requests with invalid day values', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    correction: {
      day: '2026-05-25T00:00:00Z',
      mode: 'replace_day',
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /correction\.day/)
})

test('normalizes camelCase agentId in telemetry batches', () => {
  const { agent_id, ...batch } = validBatch
  const result = validateTelemetryBatch({ ...batch, agentId: agent_id })
  assert.equal(result.ok, true)
  assert.equal(result.batch.agent_id, agent_id)
})

test('rejects telemetry batches without agent_id', () => {
  const { agent_id, ...batch } = validBatch
  const result = validateTelemetryBatch(batch)
  assert.equal(result.ok, false)
  assert.match(result.error, /agent_id/)
})

test('validates an agent-provided dashboard spec', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    dashboard_spec: {
      schema_version: 'swarm.dashboard.v1',
      title: 'Support Agent Report',
      widgets: [
        {
          id: 'tickets',
          title: 'Tickets Closed',
          type: 'stat',
          query: {
            kind: 'metric_sum',
            platform: 'support',
            artifact_type: 'ticket',
            metric: 'closed',
          },
        },
      ],
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.batch.dashboard_spec.title, 'Support Agent Report')
  assert.equal(result.batch.dashboard_spec.widgets[0].query.kind, 'metric_sum')
})

test('validates latest metric value dashboard widgets', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    dashboard_spec: {
      schema_version: 'swarm.dashboard.v1',
      title: 'Support Agent Report',
      widgets: [
        {
          id: 'latest_closed',
          title: 'Latest Closed',
          type: 'stat',
          query: {
            kind: 'latest_metric_value',
            platform: 'support',
            artifact_type: 'ticket',
            metric: 'closed',
          },
        },
      ],
    },
  })

  assert.equal(result.ok, true)
  assert.equal(result.batch.dashboard_spec.widgets[0].query.kind, 'latest_metric_value')
})

test('rejects unsupported dashboard widget queries', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    dashboard_spec: {
      schema_version: 'swarm.dashboard.v1',
      title: 'Bad Report',
      widgets: [{ id: 'bad', title: 'Bad', type: 'stat', query: { kind: 'raw_sql' } }],
    },
  })

  assert.equal(result.ok, false)
  assert.match(result.error, /dashboard_spec/)
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

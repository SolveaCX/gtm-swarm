import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_TELEMETRY_BYTES,
  canonicalizeTelemetryKey,
  validateDashboardSpec,
  validateJobCompletion,
  validateTelemetryBatch,
} from './swarm-schema.js'

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

test('validates latest per-artifact sums and weighted ratio queries', () => {
  const result = validateDashboardSpec({
    schema_version: 'swarm.dashboard.v1',
    title: 'Paid Ads',
    widgets: [
      {
        id: 'spend_usd',
        title: 'Spend',
        type: 'stat',
        query: {
          kind: 'latest_metric_sum',
          platform: 'paid_ads',
          artifact_type: 'campaign',
          metric: 'spend_usd',
        },
      },
      {
        id: 'ctr_percent',
        title: 'CTR',
        type: 'stat',
        query: {
          kind: 'latest_metric_ratio',
          platform: 'paid_ads',
          artifact_type: 'campaign',
          numerator_metric: 'link_clicks',
          denominator_metric: 'impressions',
          multiplier: 100,
        },
      },
    ],
  })

  assert.equal(result.ok, true)
  assert.equal(result.spec.widgets[0].query.kind, 'latest_metric_sum')
  assert.equal(result.spec.widgets[1].query.numerator_metric, 'link_clicks')
  assert.equal(result.spec.widgets[1].query.denominator_metric, 'impressions')
  assert.equal(result.spec.widgets[1].query.multiplier, 100)
})

test('rejects incomplete or unsafe latest aggregate query parameters', () => {
  const validRatio = {
    kind: 'latest_metric_ratio',
    platform: 'paid_ads',
    artifact_type: 'campaign',
    numerator_metric: 'link_clicks',
    denominator_metric: 'impressions',
    multiplier: 100,
  }
  const invalidQueries = [
    { ...validRatio, artifact_type: '' },
    { ...validRatio, numerator_metric: "clicks') FROM workspaces; --" },
    { ...validRatio, denominator_metric: undefined },
    { ...validRatio, multiplier: Number.POSITIVE_INFINITY },
    { ...validRatio, multiplier: '100' },
    { ...validRatio, limit: 101 },
    {
      kind: 'latest_metric_sum',
      platform: 'paid_ads',
      artifact_type: 'campaign',
      metric: 'spend_usd',
      metrics: ['spend_usd', 123],
    },
  ]

  for (const [index, query] of invalidQueries.entries()) {
    const result = validateDashboardSpec({
      schema_version: 'swarm.dashboard.v1',
      title: 'Invalid Paid Ads',
      widgets: [{ id: `invalid_${index}`, title: 'Invalid', type: 'stat', query }],
    })
    assert.equal(result.ok, false, `query ${index} should be rejected`)
    assert.match(result.error, /dashboard_spec\.widgets\[0\]\.query/)
  }
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

test('rejects unsafe metric names before they can reach dynamic report SQL', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    dashboard_spec: {
      schema_version: 'swarm.dashboard.v1',
      title: 'Unsafe Report',
      widgets: [{
        id: 'unsafe',
        title: 'Unsafe',
        type: 'leaderboard',
        query: {
          kind: 'latest_metric_leaderboard',
          platform: 'paid_ads',
          artifact_type: 'campaign',
          metrics: ["spend_usd') FROM workspaces; --"],
        },
      }],
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /safe metric names/)
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

test('rejects credential-shaped fields anywhere in telemetry', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    artifacts: [{
      ...validBatch.artifacts[0],
      payload: { provider: { accessToken: 'must-not-persist' } },
    }],
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /must not contain credentials/)
  assert.doesNotMatch(result.error, /must-not-persist/)
})

test('credential scanning handles deeply nested telemetry without recursion overflow', () => {
  let nested = { safe_value: true }
  for (let index = 0; index < 20_000; index += 1) nested = [nested]

  assert.doesNotThrow(() => validateTelemetryBatch({ ...validBatch, extra: nested }))
})

test('canonicalizes credential field names across camel, snake, kebab, spaces, and case', () => {
  for (const key of ['apiKey', 'api_key', 'api-key', 'API KEY', 'APIKEY']) {
    assert.equal(canonicalizeTelemetryKey(key), 'apikey')
  }
})

test('rejects canonical credential patterns in any telemetry payload', () => {
  const credentialKeys = [
    'apiKey',
    'STRIPE_API_KEY',
    'access-token',
    'sessionToken',
    'AWS_SECRET_ACCESS_KEY',
    'private_key',
    'serviceCredential',
    'PASSWORD',
    'clientSecret',
    'refreshToken',
    'authorization',
  ]

  for (const key of credentialKeys) {
    const result = validateTelemetryBatch({
      ...validBatch,
      artifacts: [{
        ...validBatch.artifacts[0],
        payload: { nested: { [key]: 'must-not-persist' } },
      }],
    })
    assert.equal(result.ok, false, `${key} should be rejected`)
    assert.match(result.error, /must not contain credentials/)
    assert.doesNotMatch(result.error, /must-not-persist/)
  }
})

test('does not mistake credential metadata and common business counters for credentials', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    artifacts: [{
      ...validBatch.artifacts[0],
      payload: {
        token_count: 120,
        inputTokens: 40,
        completion_tokens: 80,
        token_usage: 120,
        secretary_name: 'Ada',
        password_reset_count: 2,
        credential_status: 'configured',
        api_key_rotation_due: false,
        private_key_enabled: false,
      },
    }],
  })

  assert.equal(result.ok, true)
})

test('rejects telemetry larger than the bounded ingest contract', () => {
  const result = validateTelemetryBatch({
    ...validBatch,
    artifacts: [{
      ...validBatch.artifacts[0],
      body: 'x'.repeat(MAX_TELEMETRY_BYTES),
    }],
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /cannot exceed/)
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

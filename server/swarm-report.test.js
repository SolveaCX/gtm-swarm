import test from 'node:test'
import assert from 'node:assert/strict'
import { buildXReportSpec, renderMcpReport, renderXReport } from './swarm-report.js'

test('builds the X report spec', () => {
  const spec = buildXReportSpec({
    workspace: 'flatkey',
    from: '2026-05-25T00:00:00Z',
    to: '2026-05-25T23:59:59Z',
    platform: 'x',
  })
  assert.equal(spec.schema_version, 'swarm.report.v1')
  assert.equal(spec.widgets.length, 5)
  assert.equal(spec.widgets[0].query.kind, 'artifact_counts')
})

test('renders report data with normalized widget outputs', async () => {
  const calls = []
  const store = {
    async countArtifactsByType(args) {
      calls.push(['counts', args])
      return { post: 2, reply: 5 }
    },
    async latestMetricLeaderboard(args) {
      calls.push(['latest', args])
      return [{
        artifact_id: 'a1',
        external_id: '179',
        url: 'https://x.com/acme/status/179',
        body: 'hello',
        observed_at: '2026-05-25T10:00:00Z',
        metrics: { views: 100, replies: 2 },
      }]
    },
    async metricDeltaLeaderboard(args) {
      calls.push(['delta', args])
      return [{
        artifact_id: 'a1',
        external_id: '179',
        current_observed_at: '2026-05-25T10:00:00Z',
        baseline_observed_at: '2026-05-25T00:00:00Z',
        delta: { views: 25, replies: 1 },
        current: { views: 100, replies: 2 },
        baseline: { views: 75, replies: 1 },
      }]
    },
  }

  const report = await renderXReport({
    workspace: 'flatkey',
    from: '2026-05-25T00:00:00Z',
    to: '2026-05-25T23:59:59Z',
    platform: 'x',
    store,
  })

  assert.deepEqual(report.today_work, { post: 2, reply: 5 })
  assert.equal(report.post_total_leaderboard[0].metrics.views, 100)
  assert.equal(report.reply_delta_leaderboard[0].delta.views, 25)
  assert.equal(calls.length, 5)
})

test('passes agent_key through every report query', async () => {
  const calls = []
  const store = {
    async countArtifactsByType(args) {
      calls.push(args)
      return {}
    },
    async latestMetricLeaderboard(args) {
      calls.push(args)
      return []
    },
    async metricDeltaLeaderboard(args) {
      calls.push(args)
      return []
    },
  }

  await renderXReport({
    workspace: 'flatkey',
    agent_key: 'x-growth-agent',
    from: '2026-05-25T00:00:00Z',
    to: '2026-05-25T23:59:59Z',
    platform: 'x',
    store,
  })

  assert.equal(calls.length, 5)
  for (const call of calls) {
    assert.equal(call.agent_key, 'x-growth-agent')
  }
})

test('renders MCP report with requested panels', async () => {
  const store = {
    async mcpSummary(args) {
      assert.equal(args.agent_key, 'voc-amazon-reviews-mcp')
      return {
        total_calls: 42,
        error_calls: 3,
        business_success_calls: 35,
        active_client_instances: 9,
      }
    },
    async mcpGroupedCounts() {
      return {
        calls_by_tool: [{ label: 'fetch_reviews', count: 20 }],
        errors_by_tool: [{ label: 'fetch_reviews', count: 2, total: 20, rate: 0.1 }],
        error_types: [{ label: 'timeout', count: 2 }],
        source_catalogs: [{ label: 'amazon-us', count: 30 }],
        top_clients: [{ label: 'claude-code', count: 25 }],
        business_success_by_tool: [{ label: 'fetch_reviews', count: 18, total: 20, rate: 0.9 }],
        route_health: [{ label: 'POST /mcp', requests: 20, http_2xx: 18, http_4xx: 1, http_5xx: 1 }],
      }
    },
    async mcpLatencyByTool() {
      return [{ tool: 'fetch_reviews', p50_ms: 800, p95_ms: 1800 }]
    },
    async mcpCallTrend() {
      return [{ bucket: '2026-05-25T00:00:00.000Z', calls: 10 }]
    },
  }

  const report = await renderMcpReport({
    workspace: 'voc-ai',
    agent_key: 'voc-amazon-reviews-mcp',
    from: '2026-05-25T00:00:00Z',
    to: '2026-05-25T23:59:59Z',
    store,
  })

  assert.equal(report.report_type, 'mcp')
  assert.equal(report.summary.total_calls, 42)
  assert.equal(report.calls_by_tool[0].label, 'fetch_reviews')
  assert.equal(report.latency_by_tool[0].p95_ms, 1800)
  assert.equal(report.route_health[0].http_5xx, 1)
})

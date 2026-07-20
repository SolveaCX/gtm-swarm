import test from 'node:test'
import assert from 'node:assert/strict'
import { buildXReportSpec, renderDashboardSpecReport, renderMcpReport, renderXReport } from './swarm-report.js'

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
  for (const [, args] of calls.filter(([kind]) => kind === 'latest')) {
    assert.equal(args.from, '2026-05-25T00:00:00Z')
    assert.equal(args.to, '2026-05-25T23:59:59Z')
  }
})

test('passes agent_id and agent_key through every report query', async () => {
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
    agent_id: 'agent-runtime-123',
    agent_key: 'x-growth-agent',
    from: '2026-05-25T00:00:00Z',
    to: '2026-05-25T23:59:59Z',
    platform: 'x',
    store,
  })

  assert.equal(calls.length, 5)
  for (const call of calls) {
    assert.equal(call.agent_id, 'agent-runtime-123')
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

test('renders an agent-provided dashboard spec', async () => {
  const calls = []
  const store = {
    async metricAggregate(args) {
      calls.push(['aggregate', args])
      return 12
    },
    async latestMetricValue(args) {
      calls.push(['latest-value', args])
      return 7
    },
    async groupedMetricAggregate(args) {
      calls.push(['grouped', args])
      return [{ label: 'email', value: 7 }, { label: 'chat', value: 5 }]
    },
    async genericLatestMetricLeaderboard(args) {
      calls.push(['leaderboard', args])
      return [{
        external_id: 'ticket-1',
        title: 'Ticket 1',
        metrics: { closed: 1 },
        payload: {
          channel: 'x',
          status: 'RUNNING',
          servable: true,
          daily_budget_usd: 10,
          access_token: 'must-not-leak',
        },
      }]
    },
  }
  const spec = {
    schema_version: 'swarm.dashboard.v1',
    title: 'Support Agent Report',
    widgets: [
      { id: 'closed', title: 'Closed', type: 'stat', query: { kind: 'metric_sum', platform: 'support', artifact_type: 'ticket', metric: 'closed' } },
      { id: 'latest_closed', title: 'Latest Closed', type: 'stat', query: { kind: 'latest_metric_value', platform: 'support', artifact_type: 'ticket', metric: 'closed' } },
      { id: 'by_channel', title: 'By Channel', type: 'bar', query: { kind: 'metric_sum_by_payload', platform: 'support', artifact_type: 'ticket', metric: 'closed', group_by: 'channel' } },
      { id: 'top', title: 'Top Tickets', type: 'leaderboard', query: { kind: 'latest_metric_leaderboard', platform: 'support', artifact_type: 'ticket', metrics: ['closed'] } },
    ],
  }

  const report = await renderDashboardSpecReport({
    workspace: 'flatkey',
    agent_key: 'support-agent',
    from: '2026-05-25T00:00:00Z',
    to: '2026-05-25T23:59:59Z',
    spec,
    store,
  })

  assert.equal(report.report_type, 'custom')
  assert.equal(report.title, 'Support Agent Report')
  assert.deepEqual(report.widgets[0].data, { value: 12 })
  assert.deepEqual(report.widgets[1].data, { value: 7 })
  assert.equal(report.widgets[2].data.rows[0].label, 'email')
  assert.equal(report.widgets[3].data.rows[0].external_id, 'ticket-1')
  assert.equal(report.widgets[3].data.rows[0].channel, 'x')
  assert.equal(report.widgets[3].data.rows[0].status, 'RUNNING')
  assert.equal(report.widgets[3].data.rows[0].servable, true)
  assert.equal(report.widgets[3].data.rows[0].daily_budget_usd, 10)
  assert.doesNotMatch(JSON.stringify(report.widgets[3].data.rows[0]), /must-not-leak|access_token/)
  assert.equal(calls.length, 4)
  assert.equal(calls[0][1].agent_key, 'support-agent')
})

test('aggregates the latest in-range snapshot per campaign and derives weighted Ads ratios', async () => {
  const from = '2026-07-01T00:00:00.000Z'
  const to = '2026-07-31T23:59:59.999Z'
  const campaigns = [
    {
      artifact_id: 'campaign-a',
      external_id: 'a',
      title: 'Campaign A',
      observations: [
        {
          observed_at: '2026-06-30T23:00:00.000Z',
          metrics: { spend_usd: 500, impressions: 5000, link_clicks: 500, conversions: 50, revenue_usd: 1000 },
        },
        {
          observed_at: '2026-07-05T12:00:00.000Z',
          metrics: { spend_usd: 5, impressions: 50, link_clicks: 5, conversions: 0, revenue_usd: 0 },
        },
        {
          observed_at: '2026-07-20T12:00:00.000Z',
          metrics: { spend_usd: 10, impressions: 100, link_clicks: 10, conversions: 1, revenue_usd: 40 },
        },
      ],
    },
    {
      artifact_id: 'campaign-b',
      external_id: 'b',
      title: 'Campaign B',
      observations: [{
        observed_at: '2026-07-15T12:00:00.000Z',
        metrics: { spend_usd: 90, impressions: 900, link_clicks: 45, conversions: 3, revenue_usd: 90 },
      }],
    },
    {
      artifact_id: 'campaign-expired',
      external_id: 'expired',
      title: 'Expired Campaign',
      observations: [{
        observed_at: '2026-06-29T12:00:00.000Z',
        metrics: { spend_usd: 9999, impressions: 99999, link_clicks: 9999, conversions: 999, revenue_usd: 99999 },
      }],
    },
  ]
  const calls = []
  const snapshots = ({ from: rangeFrom, to: rangeTo }) => campaigns.flatMap(campaign => {
    const observation = campaign.observations
      .filter(item => item.observed_at >= rangeFrom && item.observed_at <= rangeTo)
      .sort((left, right) => right.observed_at.localeCompare(left.observed_at))[0]
    return observation ? [{ ...campaign, ...observation }] : []
  })
  const store = {
    async latestMetricSum(args) {
      calls.push(['sum', args])
      return snapshots(args).reduce((total, row) => total + Number(row.metrics[args.metric] || 0), 0)
    },
    async latestMetricRatio(args) {
      calls.push(['ratio', args])
      const rows = snapshots(args)
      const numerator = rows.reduce((total, row) => total + Number(row.metrics[args.numerator_metric] || 0), 0)
      const denominator = rows.reduce((total, row) => total + Number(row.metrics[args.denominator_metric] || 0), 0)
      return denominator ? numerator / denominator * args.multiplier : 0
    },
    async genericLatestMetricLeaderboard(args) {
      calls.push(['leaderboard', args])
      return snapshots(args)
        .sort((left, right) => Number(right.metrics[args.metrics[0]] || 0) - Number(left.metrics[args.metrics[0]] || 0))
        .slice(0, args.limit)
    },
  }
  const additive = ['spend_usd', 'impressions', 'link_clicks', 'conversions', 'revenue_usd']
  const ratios = {
    ctr_percent: ['link_clicks', 'impressions', 100],
    cpc_usd: ['spend_usd', 'link_clicks', 1],
    roas: ['revenue_usd', 'spend_usd', 1],
  }
  const metricOrder = [
    'spend_usd',
    'impressions',
    'link_clicks',
    'ctr_percent',
    'cpc_usd',
    'conversions',
    'revenue_usd',
    'roas',
  ]
  const spec = {
    schema_version: 'swarm.dashboard.v1',
    title: 'Paid Ads Campaign Performance',
    widgets: [
      ...metricOrder.map(id => ({
        id,
        title: id,
        type: 'stat',
        query: additive.includes(id)
          ? { kind: 'latest_metric_sum', platform: 'paid_ads', artifact_type: 'campaign', metric: id }
          : {
              kind: 'latest_metric_ratio',
              platform: 'paid_ads',
              artifact_type: 'campaign',
              numerator_metric: ratios[id][0],
              denominator_metric: ratios[id][1],
              multiplier: ratios[id][2],
            },
      })),
      {
        id: 'campaigns',
        title: 'Campaigns',
        type: 'leaderboard',
        query: {
          kind: 'latest_metric_leaderboard',
          platform: 'paid_ads',
          artifact_type: 'campaign',
          metrics: additive,
          limit: 20,
        },
      },
    ],
  }

  const report = await renderDashboardSpecReport({
    workspace: 'pricing-analyse',
    agent_id: 'paid-ads-agent',
    agent_key: 'ads-agent',
    platform: 'paid_ads',
    from,
    to,
    spec,
    store,
  })
  const values = Object.fromEntries(report.widgets.slice(0, 8).map(widget => [widget.id, widget.data.value]))
  const rows = report.widgets.find(widget => widget.id === 'campaigns').data.rows

  assert.deepEqual(metricOrder, report.widgets.slice(0, 8).map(widget => widget.id))
  assert.equal(values.spend_usd, 100)
  assert.equal(values.impressions, 1000)
  assert.equal(values.link_clicks, 55)
  assert.equal(values.conversions, 4)
  assert.equal(values.revenue_usd, 130)
  assert.equal(values.ctr_percent, 5.5)
  assert.equal(values.cpc_usd, 100 / 55)
  assert.equal(values.roas, 1.3)
  assert.deepEqual(rows.map(row => row.external_id), ['b', 'a'])
  assert.ok(rows.every(row => row.external_id !== 'expired'))
  assert.ok(calls.every(([, args]) => args.from === from && args.to === to))
})

import {
  countArtifactsByType,
  latestMetricLeaderboard,
  metricDeltaLeaderboard,
  mcpCallTrend,
  mcpGroupedCounts,
  mcpLatencyByTool,
  mcpSummary,
} from './swarm-store.js'

const DEFAULT_METRICS = ['views', 'replies']

export function buildXReportSpec({ workspace, agent_key = '', from, to, platform = 'x' }) {
  return {
    schema_version: 'swarm.report.v1',
    title: 'X Agent Dashboard',
    params: { workspace, agent_key, from, to, platform },
    widgets: [
      {
        id: 'today_work',
        title: "Today's Work",
        type: 'stat_group',
        query: {
          kind: 'artifact_counts',
          platform,
          artifact_types: ['post', 'reply'],
          time_field: 'created_at',
          range: '$range',
        },
      },
      ...['post', 'reply'].flatMap(artifactType => {
        const plural = artifactType === 'reply' ? 'Replies' : 'Posts'
        return [
        {
          id: `${artifactType}_total_leaderboard`,
          title: `${plural} Total Ranking`,
          type: 'leaderboard',
          query: {
            kind: 'latest_metric_leaderboard',
            platform,
            artifact_type: artifactType,
            metrics: DEFAULT_METRICS,
            limit: 20,
          },
        },
        {
          id: `${artifactType}_delta_leaderboard`,
          title: `${plural} Delta Ranking`,
          type: 'leaderboard',
          query: {
            kind: 'metric_delta_leaderboard',
            platform,
            artifact_type: artifactType,
            metrics: DEFAULT_METRICS,
            range: '$range',
            limit: 20,
          },
        },
      ]
      }),
    ],
  }
}

function normalizeCounts(counts) {
  return {
    post: Number(counts?.post || 0),
    reply: Number(counts?.reply || 0),
  }
}

function normalizeRows(rows, mode) {
  return (rows || []).map(row => ({
    artifact_id: row.artifact_id,
    external_id: row.external_id,
    url: row.url,
    title: row.title || row.body || row.external_id,
    body: row.body,
    observed_at: row.observed_at || row.current_observed_at || null,
    baseline_observed_at: row.baseline_observed_at || null,
    metrics: row.metrics || null,
    current: row.current || null,
    baseline: row.baseline || null,
    delta: row.delta || null,
    mode,
  }))
}

export async function renderXReport({ workspace, agent_key = '', from, to, platform = 'x', store = null }) {
  const data = store || {
    countArtifactsByType,
    latestMetricLeaderboard,
    metricDeltaLeaderboard,
  }
  const range = { from, to }
  const base = { workspace, agent_key, platform }
  const [counts, postTotal, replyTotal, postDelta, replyDelta] = await Promise.all([
    data.countArtifactsByType({ ...base, from, to }),
    data.latestMetricLeaderboard({ ...base, artifact_type: 'post', metrics: DEFAULT_METRICS, limit: 20 }),
    data.latestMetricLeaderboard({ ...base, artifact_type: 'reply', metrics: DEFAULT_METRICS, limit: 20 }),
    data.metricDeltaLeaderboard({ ...base, artifact_type: 'post', metrics: DEFAULT_METRICS, from, to, limit: 20 }),
    data.metricDeltaLeaderboard({ ...base, artifact_type: 'reply', metrics: DEFAULT_METRICS, from, to, limit: 20 }),
  ])

  return {
    spec: buildXReportSpec({ workspace, agent_key, from, to, platform }),
    range,
    platform,
    agent_key,
    today_work: normalizeCounts(counts),
    post_total_leaderboard: normalizeRows(postTotal, 'total'),
    reply_total_leaderboard: normalizeRows(replyTotal, 'total'),
    post_delta_leaderboard: normalizeRows(postDelta, 'delta'),
    reply_delta_leaderboard: normalizeRows(replyDelta, 'delta'),
  }
}

function normalizeRate(value) {
  return Number(value || 0)
}

export async function renderMcpReport({ workspace, agent_key = '', from, to, store = null }) {
  const data = store || {
    mcpSummary,
    mcpGroupedCounts,
    mcpLatencyByTool,
    mcpCallTrend,
  }
  const [summary, grouped, latencyByTool, callTrend] = await Promise.all([
    data.mcpSummary({ workspace, agent_key, from, to }),
    data.mcpGroupedCounts({ workspace, agent_key, from, to }),
    data.mcpLatencyByTool({ workspace, agent_key, from, to }),
    data.mcpCallTrend({ workspace, agent_key, from, to }),
  ])

  return {
    report_type: 'mcp',
    platform: 'mcp',
    agent_key,
    range: { from, to },
    summary: {
      total_calls: Number(summary?.total_calls || 0),
      error_calls: Number(summary?.error_calls || 0),
      error_rate: summary?.total_calls ? Number(summary.error_calls || 0) / Number(summary.total_calls) : 0,
      business_success_calls: Number(summary?.business_success_calls || 0),
      business_success_rate: summary?.total_calls ? Number(summary.business_success_calls || 0) / Number(summary.total_calls) : 0,
      active_client_instances: Number(summary?.active_client_instances || 0),
    },
    call_trend: (callTrend || []).map(row => ({ bucket: row.bucket, calls: Number(row.calls || 0) })),
    calls_by_tool: grouped.calls_by_tool || [],
    errors_by_tool: (grouped.errors_by_tool || []).map(row => ({ ...row, rate: normalizeRate(row.rate) })),
    latency_by_tool: (latencyByTool || []).map(row => ({
      tool: row.tool,
      p50_ms: Number(row.p50_ms || 0),
      p95_ms: Number(row.p95_ms || 0),
    })),
    top_clients: grouped.top_clients || [],
    error_types: grouped.error_types || [],
    business_success_by_tool: (grouped.business_success_by_tool || []).map(row => ({ ...row, rate: normalizeRate(row.rate) })),
    source_catalogs: grouped.source_catalogs || [],
    route_health: grouped.route_health || [],
  }
}

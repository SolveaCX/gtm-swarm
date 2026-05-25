import {
  countArtifactsByType,
  latestMetricLeaderboard,
  metricDeltaLeaderboard,
} from './swarm-store.js'

const DEFAULT_METRICS = ['views', 'replies']

export function buildXReportSpec({ workspace, from, to, platform = 'x' }) {
  return {
    schema_version: 'swarm.report.v1',
    title: 'X Agent Dashboard',
    params: { workspace, from, to, platform },
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

export async function renderXReport({ workspace, from, to, platform = 'x', store = null }) {
  const data = store || {
    countArtifactsByType,
    latestMetricLeaderboard,
    metricDeltaLeaderboard,
  }
  const range = { from, to }
  const [counts, postTotal, replyTotal, postDelta, replyDelta] = await Promise.all([
    data.countArtifactsByType({ workspace, platform, from, to }),
    data.latestMetricLeaderboard({ workspace, platform, artifact_type: 'post', metrics: DEFAULT_METRICS, limit: 20 }),
    data.latestMetricLeaderboard({ workspace, platform, artifact_type: 'reply', metrics: DEFAULT_METRICS, limit: 20 }),
    data.metricDeltaLeaderboard({ workspace, platform, artifact_type: 'post', metrics: DEFAULT_METRICS, from, to, limit: 20 }),
    data.metricDeltaLeaderboard({ workspace, platform, artifact_type: 'reply', metrics: DEFAULT_METRICS, from, to, limit: 20 }),
  ])

  return {
    spec: buildXReportSpec({ workspace, from, to, platform }),
    range,
    platform,
    today_work: normalizeCounts(counts),
    post_total_leaderboard: normalizeRows(postTotal, 'total'),
    reply_total_leaderboard: normalizeRows(replyTotal, 'total'),
    post_delta_leaderboard: normalizeRows(postDelta, 'delta'),
    reply_delta_leaderboard: normalizeRows(replyDelta, 'delta'),
  }
}

export function utcDayString(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

export function previousUtcDay(date = new Date()) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  d.setUTCDate(d.getUTCDate() - 1)
  return utcDayString(d)
}

export function dayWindow(day) {
  return {
    from: `${day}T00:00:00.000Z`,
    to: `${day}T23:59:59.999Z`,
  }
}

export function buildDailyTargetFromBatch(batch) {
  return {
    workspace: batch.workspace,
    agent_key: batch.agent_key,
    platform: batch.observations?.[0]?.platform || batch.artifacts?.[0]?.platform || 'unknown',
    report_type: (batch.observations?.[0]?.platform || batch.artifacts?.[0]?.platform) === 'mcp' ? 'mcp' : 'generic',
  }
}

export function buildDailyCollectionJobTarget({ day, target, runId }) {
  const window = dayWindow(day)
  return {
    daily_run_id: runId,
    day,
    from: window.from,
    to: window.to,
    report_type: target.report_type,
    expected_artifact_type: `${target.platform}_daily_summary`,
    required_metrics: target.report_type === 'mcp'
      ? ['total_calls', 'error_rate', 'business_success_rate', 'active_client_instances', 'p50_latency_ms', 'p95_latency_ms']
      : [],
  }
}

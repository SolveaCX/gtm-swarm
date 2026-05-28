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
  const platform = batch.dashboard_spec?.widgets?.find(widget => widget.query?.platform)?.query.platform ||
    batch.observations?.[0]?.platform ||
    batch.artifacts?.[0]?.platform ||
    'unknown'
  return {
    workspace: batch.workspace,
    agent_id: batch.agent_id,
    agent_key: batch.agent_key,
    platform,
    report_type: batch.dashboard_spec ? 'custom' : platform === 'mcp' ? 'mcp' : 'generic',
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

export function buildDailyDispatchDescription({ target, day, runId, jobId, publicUrl = '' }) {
  const window = dayWindow(day)
  const completeUrl = publicUrl
    ? `${publicUrl.replace(/\/$/, '')}/api/swarm/jobs/${jobId}/complete`
    : `/api/swarm/jobs/${jobId}/complete`
  const requiredMetrics = buildDailyCollectionJobTarget({ day, target, runId }).required_metrics
  return [
    '## GTM Swarm Daily Telemetry Collection',
    '',
    `Workspace: ${target.workspace_slug}`,
    `Agent key: ${target.agent_key}`,
    `Platform: ${target.platform}`,
    `Report type: ${target.report_type}`,
    `Day: ${day}`,
    `From: ${window.from}`,
    `To: ${window.to}`,
    `Swarm job id: ${jobId}`,
    `Daily run id: ${runId}`,
    '',
    'Task:',
    'Collect the daily telemetry summary for this agent, platform, and UTC day.',
    'Use the agent-specific Daily Telemetry Collection section in your SKILL.md for channel-specific collection steps.',
    '',
    'Return format:',
    '- Complete the Swarm job with a JSON payload.',
    '- Successful completion should include a `batch` using `schema_version: "swarm.telemetry.v1"`.',
    '- Observations must use numeric metric values and ISO 8601 timestamps.',
    requiredMetrics.length ? `- Required metrics: ${requiredMetrics.join(', ')}` : '- Required metrics: use the metrics defined by this agent and platform.',
    '',
    `Completion endpoint: POST ${completeUrl}`,
    '',
    'If collection cannot be completed, complete the job with `status: "failed"` and a specific `error` or `summary`.',
  ].join('\n')
}

export function buildDailyDispatchStatusFragment({ status, issueId = '', taskId = '', reason = '' }) {
  const parts = [`dispatch=${status}`]
  if (issueId) parts.push(`multica_issue=${issueId}`)
  if (taskId) parts.push(`multica_task=${taskId}`)
  if (reason) parts.push(`reason=${reason}`)
  return `${parts.join('; ')}; `
}

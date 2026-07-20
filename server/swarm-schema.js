export const TELEMETRY_SCHEMA_VERSION = 'swarm.telemetry.v1'
export const DASHBOARD_SCHEMA_VERSION = 'swarm.dashboard.v1'
export const MAX_TELEMETRY_BYTES = 512 * 1024
const DASHBOARD_QUERY_KINDS = new Set([
  'artifact_counts',
  'metric_sum',
  'metric_avg',
  'latest_metric_value',
  'latest_metric_sum',
  'latest_metric_ratio',
  'metric_sum_by_payload',
  'latest_metric_leaderboard',
])
const EXACT_CREDENTIAL_KEYS = new Set([
  'authorization',
  'authentication',
  'bearer',
])
const CREDENTIAL_KEY_SUFFIXES = [
  'apikey',
  'accesstoken',
  'sessiontoken',
  'secretaccesskey',
  'privatekey',
  'credential',
  'credentials',
  'password',
  'secret',
  'token',
]
const SAFE_METRIC_NAME = /^[a-z][a-z0-9_]{0,63}$/
const SAFE_QUERY_NAME = /^[a-z][a-z0-9_.-]{0,63}$/
const METRIC_QUERY_KINDS = new Set([
  'metric_sum',
  'metric_avg',
  'latest_metric_value',
  'latest_metric_sum',
  'metric_sum_by_payload',
])
const ARTIFACT_TYPE_QUERY_KINDS = new Set([
  ...METRIC_QUERY_KINDS,
  'latest_metric_ratio',
  'latest_metric_leaderboard',
])

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoTimestamp(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value))
}

function normalizeTimestamp(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback
  return new Date(value).toISOString()
}

function normalizeObject(value) {
  return isObject(value) ? value : {}
}

function fail(error) {
  return { ok: false, error }
}

export function canonicalizeTelemetryKey(key) {
  return String(key)
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
}

function isCredentialKey(key) {
  const canonical = canonicalizeTelemetryKey(key)
  if (EXACT_CREDENTIAL_KEYS.has(canonical)) return true
  return CREDENTIAL_KEY_SUFFIXES.some(suffix => canonical.endsWith(suffix))
}

function credentialPath(value, path = 'batch') {
  const seen = new Set()
  const pending = [{ value, path }]

  while (pending.length) {
    const current = pending.pop()
    if (!current.value || typeof current.value !== 'object') continue
    if (seen.has(current.value)) continue
    seen.add(current.value)

    if (Array.isArray(current.value)) {
      for (let i = current.value.length - 1; i >= 0; i -= 1) {
        pending.push({ value: current.value[i], path: `${current.path}[${i}]` })
      }
      continue
    }

    const entries = Object.entries(current.value)
    for (const [key] of entries) {
      if (isCredentialKey(key)) return `${current.path}.${key}`
    }
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      const [key, nested] = entries[i]
      pending.push({ value: nested, path: `${current.path}.${key}` })
    }
  }
  return null
}

function serializedByteLength(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function normalizeMetricValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

export function validateMetrics(metrics, path = 'metrics') {
  if (!isObject(metrics)) return `${path} must be an object`
  for (const [key, value] of Object.entries(metrics)) {
    if (!isNonEmptyString(key)) return `${path} contains an empty metric name`
    if (!SAFE_METRIC_NAME.test(key)) return `${path}.${key} must be a safe metric name`
    if (normalizeMetricValue(value) === null) return `${path}.${key} must be a finite number`
  }
  return null
}

function normalizeStringList(value) {
  return Array.isArray(value)
    ? value.filter(isNonEmptyString).map(item => item.trim())
    : []
}

function validateTelemetryCorrection(input) {
  if (input === undefined || input === null) return { ok: true, correction: null }
  if (!isObject(input)) return fail('correction must be an object')
  if (input.mode !== 'replace_day') return fail('correction.mode must be replace_day')
  if (!isNonEmptyString(input.day) || !/^\d{4}-\d{2}-\d{2}$/.test(input.day)) {
    return fail('correction.day must be YYYY-MM-DD')
  }
  const parsed = new Date(`${input.day}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.day) {
    return fail('correction.day must be a valid UTC date')
  }
  return { ok: true, correction: { day: input.day, mode: 'replace_day' } }
}

export function validateDashboardSpec(input) {
  if (input === undefined || input === null) return { ok: true, spec: null }
  if (!isObject(input)) return fail('dashboard_spec must be an object')
  if (input.schema_version !== DASHBOARD_SCHEMA_VERSION) {
    return fail(`dashboard_spec.schema_version must be ${DASHBOARD_SCHEMA_VERSION}`)
  }
  if (!isNonEmptyString(input.title)) return fail('dashboard_spec.title is required')
  if (!Array.isArray(input.widgets) || input.widgets.length === 0) return fail('dashboard_spec.widgets are required')
  if (input.widgets.length > 24) return fail('dashboard_spec.widgets cannot exceed 24')

  const widgets = []
  const ids = new Set()
  for (let i = 0; i < input.widgets.length; i += 1) {
    const widget = input.widgets[i]
    const path = `dashboard_spec.widgets[${i}]`
    if (!isObject(widget)) return fail(`${path} must be an object`)
    for (const field of ['id', 'title', 'type']) {
      if (!isNonEmptyString(widget[field])) return fail(`${path}.${field} is required`)
    }
    const id = widget.id.trim()
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return fail(`${path}.id must be a stable slug`)
    if (ids.has(id)) return fail(`${path}.id must be unique`)
    ids.add(id)
    if (!isObject(widget.query)) return fail(`${path}.query is required`)
    if (!DASHBOARD_QUERY_KINDS.has(widget.query.kind)) return fail(`${path}.query.kind is unsupported`)
    for (const field of ['platform', 'artifact_type', 'metric', 'numerator_metric', 'denominator_metric', 'group_by']) {
      if (widget.query[field] !== undefined && !isNonEmptyString(widget.query[field])) {
        return fail(`${path}.query.${field} must be a non-empty string`)
      }
    }
    for (const field of ['metrics', 'artifact_types']) {
      if (widget.query[field] !== undefined && (
        !Array.isArray(widget.query[field]) ||
        widget.query[field].some(item => !isNonEmptyString(item))
      )) {
        return fail(`${path}.query.${field} must contain non-empty strings`)
      }
    }

    const platform = isNonEmptyString(widget.query.platform) ? widget.query.platform.trim().toLowerCase() : ''
    const artifactType = isNonEmptyString(widget.query.artifact_type) ? widget.query.artifact_type.trim().toLowerCase() : ''
    const metric = isNonEmptyString(widget.query.metric) ? widget.query.metric.trim() : ''
    const metrics = normalizeStringList(widget.query.metrics)
    const numeratorMetric = isNonEmptyString(widget.query.numerator_metric) ? widget.query.numerator_metric.trim() : ''
    const denominatorMetric = isNonEmptyString(widget.query.denominator_metric) ? widget.query.denominator_metric.trim() : ''
    const groupBy = isNonEmptyString(widget.query.group_by) ? widget.query.group_by.trim() : ''
    const artifactTypes = normalizeStringList(widget.query.artifact_types).map(item => item.toLowerCase())
    const limit = widget.query.limit === undefined ? 20 : widget.query.limit
    const multiplier = widget.query.multiplier === undefined ? 1 : widget.query.multiplier

    if (platform && !SAFE_QUERY_NAME.test(platform)) return fail(`${path}.query.platform must be a safe name`)
    if (artifactType && !SAFE_QUERY_NAME.test(artifactType)) return fail(`${path}.query.artifact_type must be a safe name`)
    if (ARTIFACT_TYPE_QUERY_KINDS.has(widget.query.kind) && !artifactType) {
      return fail(`${path}.query.artifact_type is required`)
    }
    if (metric && !SAFE_METRIC_NAME.test(metric)) return fail(`${path}.query.metric must be a safe metric name`)
    if (numeratorMetric && !SAFE_METRIC_NAME.test(numeratorMetric)) return fail(`${path}.query.numerator_metric must be a safe metric name`)
    if (denominatorMetric && !SAFE_METRIC_NAME.test(denominatorMetric)) return fail(`${path}.query.denominator_metric must be a safe metric name`)
    if (metrics.some(item => !SAFE_METRIC_NAME.test(item))) return fail(`${path}.query.metrics must contain safe metric names`)
    if (metrics.length > 16) return fail(`${path}.query.metrics cannot exceed 16 items`)
    if (METRIC_QUERY_KINDS.has(widget.query.kind) && !metric) {
      return fail(`${path}.query.metric is required`)
    }
    if (widget.query.kind === 'latest_metric_leaderboard' && metrics.length === 0) {
      return fail(`${path}.query.metrics is required`)
    }
    if (widget.query.kind === 'latest_metric_ratio') {
      if (!numeratorMetric) return fail(`${path}.query.numerator_metric is required`)
      if (!denominatorMetric) return fail(`${path}.query.denominator_metric is required`)
    }
    if (typeof multiplier !== 'number' || !Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 1_000_000) {
      return fail(`${path}.query.multiplier must be a positive finite number no greater than 1000000`)
    }
    if (widget.query.kind === 'metric_sum_by_payload') {
      if (!groupBy || !SAFE_QUERY_NAME.test(groupBy)) return fail(`${path}.query.group_by must be a safe name`)
    } else if (groupBy && !SAFE_QUERY_NAME.test(groupBy)) {
      return fail(`${path}.query.group_by must be a safe name`)
    }
    if (artifactTypes.some(item => !SAFE_QUERY_NAME.test(item))) {
      return fail(`${path}.query.artifact_types must contain safe names`)
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return fail(`${path}.query.limit must be an integer from 1 to 100`)
    }

    widgets.push({
      id,
      title: widget.title.trim(),
      type: widget.type.trim(),
      description: isNonEmptyString(widget.description) ? widget.description.trim() : '',
      query: {
        kind: widget.query.kind,
        platform,
        artifact_type: artifactType,
        metric,
        metrics,
        numerator_metric: numeratorMetric,
        denominator_metric: denominatorMetric,
        multiplier,
        group_by: groupBy,
        artifact_types: artifactTypes,
        limit,
      },
    })
  }
  return {
    ok: true,
    spec: {
      schema_version: DASHBOARD_SCHEMA_VERSION,
      title: input.title.trim(),
      description: isNonEmptyString(input.description) ? input.description.trim() : '',
      widgets,
    },
  }
}

export function validateTelemetryBatch(input) {
  if (!isObject(input)) return fail('batch must be an object')
  if (serializedByteLength(input) > MAX_TELEMETRY_BYTES) {
    return fail(`batch cannot exceed ${MAX_TELEMETRY_BYTES} bytes`)
  }
  const unsafePath = credentialPath(input)
  if (unsafePath) return fail(`${unsafePath} must not contain credentials`)
  if (input.schema_version !== TELEMETRY_SCHEMA_VERSION) {
    return fail(`schema_version must be ${TELEMETRY_SCHEMA_VERSION}`)
  }
  if (!isNonEmptyString(input.workspace)) return fail('workspace is required')
  const agentId = input.agent_id ?? input.agentId
  if (!isNonEmptyString(agentId)) return fail('agent_id is required')
  if (!isNonEmptyString(input.agent_key)) return fail('agent_key is required')
  if (!isNonEmptyString(input.node_id)) return fail('node_id is required')
  if (input.sent_at !== undefined && !isIsoTimestamp(input.sent_at)) return fail('sent_at must be an ISO timestamp')
  const dashboardSpecResult = validateDashboardSpec(input.dashboard_spec)
  if (!dashboardSpecResult.ok) return fail(dashboardSpecResult.error)
  const correctionResult = validateTelemetryCorrection(input.correction)
  if (!correctionResult.ok) return fail(correctionResult.error)

  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : []
  const observations = Array.isArray(input.observations) ? input.observations : []
  if (!artifacts.length && !observations.length && !dashboardSpecResult.spec) return fail('artifacts, observations, or dashboard_spec are required')

  const normalizedArtifacts = []
  const batchArtifactKeys = new Set()
  for (let i = 0; i < artifacts.length; i += 1) {
    const item = artifacts[i]
    const path = `artifacts[${i}]`
    if (!isObject(item)) return fail(`${path} must be an object`)
    for (const field of ['platform', 'artifact_type', 'external_id', 'created_at']) {
      if (!isNonEmptyString(item[field])) return fail(`${path}.${field} is required`)
    }
    if (!isIsoTimestamp(item.created_at)) return fail(`${path}.created_at must be an ISO timestamp`)
    if (item.source_time !== undefined && item.source_time !== null && !isIsoTimestamp(item.source_time)) {
      return fail(`${path}.source_time must be an ISO timestamp`)
    }
    const artifact = {
      platform: item.platform.trim().toLowerCase(),
      artifact_type: item.artifact_type.trim().toLowerCase(),
      external_id: String(item.external_id).trim(),
      url: item.url || null,
      title: item.title || null,
      body: item.body || null,
      created_at: normalizeTimestamp(item.created_at),
      source_time: normalizeTimestamp(item.source_time),
      payload: normalizeObject(item.payload),
    }
    batchArtifactKeys.add(`${artifact.platform}:${artifact.artifact_type}:${artifact.external_id}`)
    normalizedArtifacts.push(artifact)
  }

  const normalizedObservations = []
  for (let i = 0; i < observations.length; i += 1) {
    const item = observations[i]
    const path = `observations[${i}]`
    if (!isObject(item)) return fail(`${path} must be an object`)
    for (const field of ['platform', 'artifact_type', 'external_id', 'observed_at']) {
      if (!isNonEmptyString(item[field])) return fail(`${path}.${field} is required`)
    }
    if (!isIsoTimestamp(item.observed_at)) return fail(`${path}.observed_at must be an ISO timestamp`)
    const metricsError = validateMetrics(item.metrics, `${path}.metrics`)
    if (metricsError) return fail(metricsError)
    normalizedObservations.push({
      platform: item.platform.trim().toLowerCase(),
      artifact_type: item.artifact_type.trim().toLowerCase(),
      external_id: String(item.external_id).trim(),
      observed_at: normalizeTimestamp(item.observed_at),
      metrics: Object.fromEntries(Object.entries(item.metrics).map(([key, value]) => [key, normalizeMetricValue(value)])),
      payload: normalizeObject(item.payload),
    })
  }

  return {
    ok: true,
    batch: {
      schema_version: TELEMETRY_SCHEMA_VERSION,
      workspace: input.workspace.trim(),
      agent_id: agentId.trim(),
      agent_key: input.agent_key.trim(),
      node_id: input.node_id.trim(),
      sent_at: normalizeTimestamp(input.sent_at, new Date().toISOString()),
      artifacts: normalizedArtifacts,
      observations: normalizedObservations,
      artifact_keys: [...batchArtifactKeys],
      dashboard_spec: dashboardSpecResult.spec,
      correction: correctionResult.correction,
    },
  }
}

export function validateJobCompletion(input) {
  if (!isObject(input)) return fail('completion must be an object')
  if (!['completed', 'failed'].includes(input.status)) return fail('status must be completed or failed')
  const completion = {
    status: input.status,
    summary: isNonEmptyString(input.summary) ? input.summary.trim() : '',
    error: isNonEmptyString(input.error) ? input.error.trim() : null,
    batch: null,
  }
  if (input.status === 'failed') {
    if (!completion.summary && !completion.error) return fail('failed completion requires summary or error')
    return { ok: true, completion }
  }
  if (input.batch !== undefined && input.batch !== null) {
    const batchResult = validateTelemetryBatch(input.batch)
    if (!batchResult.ok) return fail(`batch: ${batchResult.error}`)
    completion.batch = batchResult.batch
  }
  return { ok: true, completion }
}

export function buildTelemetryBatch({ workspace, agent_id, agent_key, node_id, artifacts = [], observations = [], sent_at = new Date().toISOString() }) {
  return {
    schema_version: TELEMETRY_SCHEMA_VERSION,
    workspace,
    agent_id,
    agent_key,
    node_id,
    sent_at,
    artifacts,
    observations,
  }
}

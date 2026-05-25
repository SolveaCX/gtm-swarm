export const TELEMETRY_SCHEMA_VERSION = 'swarm.telemetry.v1'

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

function normalizeMetricValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

export function validateMetrics(metrics, path = 'metrics') {
  if (!isObject(metrics)) return `${path} must be an object`
  for (const [key, value] of Object.entries(metrics)) {
    if (!isNonEmptyString(key)) return `${path} contains an empty metric name`
    if (normalizeMetricValue(value) === null) return `${path}.${key} must be a finite number`
  }
  return null
}

export function validateTelemetryBatch(input) {
  if (!isObject(input)) return fail('batch must be an object')
  if (input.schema_version !== TELEMETRY_SCHEMA_VERSION) {
    return fail(`schema_version must be ${TELEMETRY_SCHEMA_VERSION}`)
  }
  if (!isNonEmptyString(input.workspace)) return fail('workspace is required')
  if (!isNonEmptyString(input.agent_key)) return fail('agent_key is required')
  if (!isNonEmptyString(input.node_id)) return fail('node_id is required')
  if (input.sent_at !== undefined && !isIsoTimestamp(input.sent_at)) return fail('sent_at must be an ISO timestamp')

  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : []
  const observations = Array.isArray(input.observations) ? input.observations : []
  if (!artifacts.length && !observations.length) return fail('artifacts or observations are required')

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
      agent_key: input.agent_key.trim(),
      node_id: input.node_id.trim(),
      sent_at: normalizeTimestamp(input.sent_at, new Date().toISOString()),
      artifacts: normalizedArtifacts,
      observations: normalizedObservations,
      artifact_keys: [...batchArtifactKeys],
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

export function buildTelemetryBatch({ workspace, agent_key, node_id, artifacts = [], observations = [], sent_at = new Date().toISOString() }) {
  return {
    schema_version: TELEMETRY_SCHEMA_VERSION,
    workspace,
    agent_key,
    node_id,
    sent_at,
    artifacts,
    observations,
  }
}

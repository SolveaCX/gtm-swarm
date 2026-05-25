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

function fail(error) {
  return { ok: false, error }
}

export function validateTelemetryBatch(input) {
  if (!isObject(input)) return fail('batch must be an object')
  if (input.schema_version !== TELEMETRY_SCHEMA_VERSION) return fail(`schema_version must be ${TELEMETRY_SCHEMA_VERSION}`)
  for (const field of ['workspace', 'agent_key', 'node_id']) {
    if (!isNonEmptyString(input[field])) return fail(`${field} is required`)
  }
  const artifacts = Array.isArray(input.artifacts) ? input.artifacts : []
  const observations = Array.isArray(input.observations) ? input.observations : []
  if (!artifacts.length && !observations.length) return fail('artifacts or observations are required')
  for (let i = 0; i < artifacts.length; i += 1) {
    const item = artifacts[i]
    for (const field of ['platform', 'artifact_type', 'external_id', 'created_at']) {
      if (!isNonEmptyString(item?.[field])) return fail(`artifacts[${i}].${field} is required`)
    }
    if (!isIsoTimestamp(item.created_at)) return fail(`artifacts[${i}].created_at must be an ISO timestamp`)
  }
  for (let i = 0; i < observations.length; i += 1) {
    const item = observations[i]
    for (const field of ['platform', 'artifact_type', 'external_id', 'observed_at']) {
      if (!isNonEmptyString(item?.[field])) return fail(`observations[${i}].${field} is required`)
    }
    if (!isIsoTimestamp(item.observed_at)) return fail(`observations[${i}].observed_at must be an ISO timestamp`)
    if (!isObject(item.metrics)) return fail(`observations[${i}].metrics must be an object`)
    for (const [key, value] of Object.entries(item.metrics)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fail(`observations[${i}].metrics.${key} must be a finite number`)
    }
  }
  return { ok: true, batch: input }
}

export function buildTelemetryBatch({ workspace, agent_key, node_id, artifacts = [], observations = [] }) {
  return {
    schema_version: TELEMETRY_SCHEMA_VERSION,
    workspace,
    agent_key,
    node_id,
    sent_at: new Date().toISOString(),
    artifacts,
    observations,
  }
}

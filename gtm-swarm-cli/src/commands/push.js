import { readFile } from 'node:fs/promises'
import { flag, listFlag, parseMetricFlags } from '../args.js'
import { requestJson } from '../client.js'
import { buildTelemetryBatch, validateTelemetryBatch } from '../schema.js'

function defaults(flags) {
  return {
    workspace: flag(flags, 'workspace', process.env.GTM_SWARM_WORKSPACE || ''),
    agent_key: flag(flags, 'agent', process.env.GTM_SWARM_AGENT || ''),
    node_id: flag(flags, 'node', process.env.GTM_SWARM_NODE || 'local'),
  }
}

async function sendBatch(batch) {
  const validation = validateTelemetryBatch(batch)
  if (!validation.ok) throw new Error(validation.error)
  return requestJson('/api/swarm/ingest', { method: 'POST', body: batch })
}

export async function pushBatch(file) {
  const body = JSON.parse(await readFile(file, 'utf-8'))
  const result = await sendBatch(body)
  console.log(JSON.stringify(result, null, 2))
}

export async function pushArtifact(flags) {
  const base = defaults(flags)
  const artifact = {
    platform: flag(flags, 'platform', 'x'),
    artifact_type: flag(flags, 'type'),
    external_id: flag(flags, 'external-id'),
    url: flag(flags, 'url') || null,
    title: flag(flags, 'title') || null,
    body: flag(flags, 'body') || null,
    created_at: flag(flags, 'created-at', new Date().toISOString()),
    payload: {},
  }
  const batch = buildTelemetryBatch({ ...base, artifacts: [artifact], observations: [] })
  const result = await sendBatch(batch)
  console.log(JSON.stringify(result, null, 2))
}

export async function pushObservation(flags) {
  const base = defaults(flags)
  const observation = {
    platform: flag(flags, 'platform', 'x'),
    artifact_type: flag(flags, 'type'),
    external_id: flag(flags, 'external-id'),
    observed_at: flag(flags, 'observed-at', new Date().toISOString()),
    metrics: parseMetricFlags(listFlag(flags, 'metric')),
    payload: {},
  }
  const batch = buildTelemetryBatch({ ...base, artifacts: [], observations: [observation] })
  const result = await sendBatch(batch)
  console.log(JSON.stringify(result, null, 2))
}

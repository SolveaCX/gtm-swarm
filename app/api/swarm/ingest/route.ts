import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { authorizeSwarmRequestForWorkspace, ingestTelemetryBatch } from '@/server/swarm-store.js'
import { MAX_TELEMETRY_BYTES, validateTelemetryBatch } from '@/server/swarm-schema.js'
import { readBoundedJsonBody } from '@/server/bounded-json-body.js'

export async function POST(request: NextRequest) {
  const parsed = await readBoundedJsonBody(request, MAX_TELEMETRY_BYTES)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })

  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  const result = validateTelemetryBatch(parsed.value)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  const auth = await authorizeSwarmRequestForWorkspace(request, result.batch.workspace)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const ingest = await ingestTelemetryBatch(result.batch)
    return NextResponse.json(ingest)
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 })
  }
}

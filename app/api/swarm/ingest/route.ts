import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { authorizeSwarmRequestForWorkspace, ingestTelemetryBatch } from '@/server/swarm-store.js'
import { validateTelemetryBatch } from '@/server/swarm-schema.js'

export async function POST(request: NextRequest) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  const body = await request.json().catch(() => null)
  const result = validateTelemetryBatch(body)
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

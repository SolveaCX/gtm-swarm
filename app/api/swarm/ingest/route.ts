import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { authorizeSwarmRequest, ingestTelemetryBatch } from '@/server/swarm-store.js'
import { validateTelemetryBatch } from '@/server/swarm-schema.js'

export async function POST(request: NextRequest) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  if (!authorizeSwarmRequest(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const result = validateTelemetryBatch(body)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  try {
    const ingest = await ingestTelemetryBatch(result.batch)
    return NextResponse.json(ingest)
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 })
  }
}

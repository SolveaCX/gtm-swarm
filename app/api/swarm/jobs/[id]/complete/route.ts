import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { MAX_TELEMETRY_BYTES, validateJobCompletion } from '@/server/swarm-schema.js'
import { authorizeSwarmRequestForJob, completeSwarmJob } from '@/server/swarm-store.js'
import { readBoundedJsonBody } from '@/server/bounded-json-body.js'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const parsed = await readBoundedJsonBody(request, MAX_TELEMETRY_BYTES)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status })

  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  const { id } = await context.params
  const auth = await authorizeSwarmRequestForJob(request, id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const result = validateJobCompletion(parsed.value)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  try {
    const job = await completeSwarmJob(id, result.completion)
    if (!job) return NextResponse.json({ error: 'job not found' }, { status: 404 })
    return NextResponse.json({ ok: true, job })
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 })
  }
}

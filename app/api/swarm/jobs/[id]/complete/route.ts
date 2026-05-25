import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { validateJobCompletion } from '@/server/swarm-schema.js'
import { authorizeSwarmRequestForJob, completeSwarmJob } from '@/server/swarm-store.js'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  const { id } = await context.params
  const auth = await authorizeSwarmRequestForJob(request, id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => null)
  const result = validateJobCompletion(body)
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

import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { validateJobCompletion } from '@/server/swarm-schema.js'
import { authorizeSwarmRequest, completeSwarmJob } from '@/server/swarm-store.js'

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  if (!authorizeSwarmRequest(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { id } = await context.params
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

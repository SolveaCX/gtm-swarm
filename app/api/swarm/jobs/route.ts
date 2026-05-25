import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { authorizeSwarmRequestForWorkspace, createSwarmJob } from '@/server/swarm-store.js'

export async function POST(request: NextRequest) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  const body = await request.json().catch(() => null)
  if (!body?.workspace) return NextResponse.json({ error: 'workspace required' }, { status: 400 })
  if (!body?.agent_key) return NextResponse.json({ error: 'agent_key required' }, { status: 400 })
  const auth = await authorizeSwarmRequestForWorkspace(request, body.workspace)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const job = await createSwarmJob(body)
    return NextResponse.json({ ok: true, job })
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { authorizeSwarmRequestForWorkspace, leaseSwarmJob } from '@/server/swarm-store.js'

export async function GET(request: NextRequest) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  const params = request.nextUrl.searchParams
  const workspace = params.get('workspace') || ''
  const node_id = params.get('node_id') || ''
  const agent_key = params.get('agent_key') || ''
  const lease_seconds = Number(params.get('lease_seconds') || '300')

  if (!workspace) return NextResponse.json({ error: 'workspace required' }, { status: 400 })
  if (!node_id) return NextResponse.json({ error: 'node_id required' }, { status: 400 })
  if (!agent_key) return NextResponse.json({ error: 'agent_key required' }, { status: 400 })
  const auth = await authorizeSwarmRequestForWorkspace(request, workspace)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  try {
    const job = await leaseSwarmJob({ workspace, node_id, agent_key, lease_seconds })
    return NextResponse.json({ job })
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 })
  }
}

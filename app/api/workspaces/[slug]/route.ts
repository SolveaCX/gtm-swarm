import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'
import { hasMultica } from '@/server/multica-db.js'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  try {
    if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
    const ws = await store.ensureWorkspaceSwarmToken(slug)
    if (!ws) return NextResponse.json({ error: 'not found' }, { status: 404 })
    const cosState = await store.getContentOSState(ws.id)

    let agents
    if (hasMultica() && ws.multica_workspace_slug) {
      const { getWorkspaceAgents } = await import('@/server/multica-db.js')
      agents = await getWorkspaceAgents(ws.multica_workspace_slug)
    } else {
      agents = await store.listAgentsForWorkspace(ws.id)
    }
    return NextResponse.json({ ...ws, contentos_state: cosState, agents })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!hasDB()) return NextResponse.json({ error: 'DATABASE_URL required' }, { status: 503 })
  try {
    const body = await request.json()
    if (body.multica_workspace_slug !== undefined) {
      const ws = await store.bindMulticaWorkspace(slug, body.multica_workspace_slug)
      if (!ws) return NextResponse.json({ error: 'already bound or not found' }, { status: 409 })
      return NextResponse.json(ws)
    }
    const ws = await store.updateWorkspace(slug, body)
    if (!ws) return NextResponse.json({ error: 'not found' }, { status: 404 })
    return NextResponse.json(ws)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

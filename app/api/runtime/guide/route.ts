import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'
import { getWorkspaceBySlug, hasMultica, listWorkspaceRuntimes } from '@/server/multica-db.js'
import { loadRuntimeFleet } from '@/server/runtime-fleet.js'
import { buildRuntimeGuide } from '@/server/runtime-guide.js'

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project') || ''
  if (!project) return NextResponse.json({ error: 'project required' }, { status: 400 })
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  try {
    const ws = await store.getWorkspace(project)
    if (!ws) return NextResponse.json({ error: 'project not found' }, { status: 404 })

    let runtimes: unknown[] = []
    let multicaWorkspace = null
    if (hasMultica() && ws.multica_workspace_slug) {
      multicaWorkspace = await getWorkspaceBySlug(ws.multica_workspace_slug)
      if (multicaWorkspace) {
        runtimes = await listWorkspaceRuntimes(multicaWorkspace.id)
      }
    }

    const guide = buildRuntimeGuide(loadRuntimeFleet(), {
      workspaceSlug: ws.multica_workspace_slug || project,
      runtimes,
    })

    return NextResponse.json({
      project,
      multica_workspace_slug: ws.multica_workspace_slug || null,
      multica_workspace_id: multicaWorkspace?.id || null,
      multica_configured: hasMultica(),
      ...guide,
    })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

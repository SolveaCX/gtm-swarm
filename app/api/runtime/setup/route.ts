import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'
import {
  createRuntimeSetupIssue,
  getOrCreateGTMUser,
  getWorkspaceBySlug,
  hasMultica,
} from '@/server/multica-db.js'
import { loadRuntimeFleet } from '@/server/runtime-fleet.js'
import { buildRuntimeGuide, renderRuntimeSetupIssue } from '@/server/runtime-guide.js'

export async function POST(request: NextRequest) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  if (!hasMultica()) return NextResponse.json({ error: 'multica not configured' }, { status: 503 })

  try {
    const body = await request.json()
    const project = body.project || ''
    const channelKey = body.channelKey || ''
    const machineKey = body.machineKey || ''
    if (!project) return NextResponse.json({ error: 'project required' }, { status: 400 })
    if (!channelKey) return NextResponse.json({ error: 'channelKey required' }, { status: 400 })

    const ws = await store.getWorkspace(project)
    if (!ws?.multica_workspace_slug) {
      return NextResponse.json({ error: 'no multica workspace bound to this project' }, { status: 400 })
    }
    const multicaWorkspace = await getWorkspaceBySlug(ws.multica_workspace_slug)
    if (!multicaWorkspace) {
      return NextResponse.json({ error: `multica workspace not found: ${ws.multica_workspace_slug}` }, { status: 404 })
    }

    const guide = buildRuntimeGuide(loadRuntimeFleet(), {
      workspaceSlug: ws.multica_workspace_slug,
      runtimes: [],
    })
    const row = guide.rows.find(item => item.channelKey === channelKey)
    if (!row) return NextResponse.json({ error: `unknown runtime channel: ${channelKey}` }, { status: 400 })

    const command = machineKey
      ? row.command.replace(/--machine\s+\S+/, `--machine ${machineKey}`)
      : row.command
    const botId = await getOrCreateGTMUser(multicaWorkspace.id)
    const issueId = await createRuntimeSetupIssue(multicaWorkspace.id, {
      creatorId: botId,
      title: `Configure ${row.label} runtime for ${ws.multica_workspace_slug}`,
      description: renderRuntimeSetupIssue({
        workspaceSlug: ws.multica_workspace_slug,
        channelLabel: row.label,
        machineKey: machineKey || row.machineKey,
        profileKey: row.profileKey,
        command,
        requiredEnv: row.requiredEnv,
        requiredPaths: row.requiredPaths,
      }),
    })

    return NextResponse.json({ ok: true, issueId, row })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

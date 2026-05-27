import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'
import {
  createRuntimeSetupIssue,
  getOrCreateGTMUser,
  getWorkspaceBySlug,
  hasMultica,
  listWorkspaceRuntimes,
  upsertRuntimeBackedAgent,
} from '@/server/multica-db.js'
import { loadRuntimeFleet } from '@/server/runtime-fleet.js'
import { buildAgentTemplatePlan, buildRuntimeGuide, renderRuntimeSetupIssue } from '@/server/runtime-guide.js'

export async function POST(request: NextRequest) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  if (!hasMultica()) return NextResponse.json({ error: 'multica not configured' }, { status: 503 })

  try {
    const body = await request.json()
    const project = body.project || ''
    const templateKey = body.templateKey || ''
    if (!project) return NextResponse.json({ error: 'project required' }, { status: 400 })
    if (!templateKey) return NextResponse.json({ error: 'templateKey required' }, { status: 400 })

    const ws = await store.getWorkspace(project)
    if (!ws?.multica_workspace_slug) {
      return NextResponse.json({ error: 'no multica workspace bound to this project' }, { status: 400 })
    }
    const multicaWorkspace = await getWorkspaceBySlug(ws.multica_workspace_slug)
    if (!multicaWorkspace) {
      return NextResponse.json({ error: `multica workspace not found: ${ws.multica_workspace_slug}` }, { status: 404 })
    }

    const fleet = loadRuntimeFleet()
    const runtimes = await listWorkspaceRuntimes(multicaWorkspace.id)
    const plan = buildAgentTemplatePlan(fleet, {
      templateKey,
      name: body.name || '',
      model: body.model || '',
      machineKey: body.machineKey || '',
      runtimes,
    })

    const agentId = await upsertRuntimeBackedAgent(multicaWorkspace.id, {
      name: plan.name,
      runtimeId: plan.runtimeId,
      runtimeMode: 'cloud',
      runtimeConfig: plan.runtimeConfig,
      status: plan.status,
    })

    let setupIssueId = null
    if (!plan.runtimeId) {
      const guide = buildRuntimeGuide(fleet, {
        workspaceSlug: ws.multica_workspace_slug,
        runtimes,
      })
      const row = guide.rows.find(item => item.profileKey === plan.runtimeProfile)
      if (row) {
        const botId = await getOrCreateGTMUser(multicaWorkspace.id)
        const command = (body.machineKey || row.machineKey)
          ? row.command.replace(/--machine\s+\S+/, `--machine ${body.machineKey || row.machineKey}`)
          : row.command
        setupIssueId = await createRuntimeSetupIssue(multicaWorkspace.id, {
          creatorId: botId,
          title: `Runtime registration needed for ${plan.name}`,
          description: renderRuntimeSetupIssue({
            workspaceSlug: ws.multica_workspace_slug,
            channelLabel: row.label,
            machineKey: body.machineKey || row.machineKey,
            profileKey: row.profileKey,
            command,
            requiredEnv: row.requiredEnv,
            requiredPaths: row.requiredPaths,
          }),
        })
      }
    }

    return NextResponse.json({ ok: true, agentId, setupIssueId, agent: plan })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

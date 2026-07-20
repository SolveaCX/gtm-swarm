import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { authorizeSwarmReadRequestForWorkspace } from '@/server/swarm-read-auth.js'
import { ensureDailyTargetsFromArtifacts, listDailyRuns, listDailyTargets } from '@/server/swarm-store.js'

const PRIVATE_STATUS_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
}

function statusJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_STATUS_HEADERS })
}

export async function GET(request: NextRequest) {
  if (!hasDB()) return statusJson({ error: 'GTM_DATABASE required' }, 503)

  const params = request.nextUrl.searchParams
  const workspace = params.get('workspace') || ''
  const agent_id = params.get('agent_id') || params.get('agentId') || ''
  const platform = params.get('platform') || ''
  const report_type = params.get('report_type') || ''
  if (!workspace) return statusJson({ error: 'workspace required' }, 400)

  const auth = await authorizeSwarmReadRequestForWorkspace(request, workspace)
  if (!auth.ok) return statusJson({ error: auth.error }, auth.status)

  try {
    await ensureDailyTargetsFromArtifacts({ workspace })
    const [targets, runs] = await Promise.all([
      listDailyTargets({ workspace, agent_id, platform, report_type }),
      listDailyRuns({ workspace, agent_id, platform, report_type, limit: 60 }),
    ])
    return statusJson({ targets, runs })
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return statusJson({ error: err.message }, err.status || 500)
  }
}

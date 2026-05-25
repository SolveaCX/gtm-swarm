import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { ensureDailyTargetsFromArtifacts, listDailyRuns, listDailyTargets } from '@/server/swarm-store.js'

export async function GET(request: NextRequest) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  const params = request.nextUrl.searchParams
  const workspace = params.get('workspace') || ''
  const platform = params.get('platform') || ''
  const report_type = params.get('report_type') || ''
  if (!workspace) return NextResponse.json({ error: 'workspace required' }, { status: 400 })

  try {
    await ensureDailyTargetsFromArtifacts({ workspace })
    const [targets, runs] = await Promise.all([
      listDailyTargets({ workspace, platform, report_type }),
      listDailyRuns({ workspace, platform, report_type, limit: 60 }),
    ])
    return NextResponse.json({ targets, runs })
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { hasMultica } from '@/server/multica-db.js'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const project = String(body.project || '').trim()
    if (!project) {
      return NextResponse.json({ error: 'project required' }, { status: 400 })
    }
    if (!hasMultica()) {
      return NextResponse.json({ error: 'multica not configured' }, { status: 503 })
    }
    if (!hasDB()) {
      return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
    }

    const ws = await store.getWorkspace(project)
    if (!ws?.multica_workspace_slug) {
      return NextResponse.json({ error: 'no multica workspace bound to this project' }, { status: 400 })
    }

    const {
      generateStrategyReviewProposals,
      createStrategyReviewIssues,
    } = await import('@/server/strategy-reviewer.js')

    const proposals = await generateStrategyReviewProposals({
      project: ws.multica_workspace_slug,
      metricsSummary: String(body.metrics_summary || ''),
      issueSummary: String(body.issue_summary || ''),
      artifactSummary: String(body.artifact_summary || ''),
    })
    const created = await createStrategyReviewIssues({
      project: ws.multica_workspace_slug,
      proposals,
    })

    return NextResponse.json({
      ok: true,
      project,
      multica_workspace_slug: ws.multica_workspace_slug,
      proposal_count: proposals.length,
      issues: created.map(row => ({
        issue_id: row.issue_id,
        type: row.proposal.type,
        title: row.proposal.title,
      })),
    })
  } catch (e: unknown) {
    console.error('[strategy-review]', e)
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}

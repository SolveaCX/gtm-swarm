import { NextRequest, NextResponse } from 'next/server'
import { collect, countsFor, reviewerQueueCount, type State } from '@/lib/fs-api'
import { hasMultica } from '@/server/multica-db.js'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const project = p.get('project') || undefined
  const state = (p.get('state') || undefined) as State | 'review' | undefined
  const agent = p.get('agent') || undefined

  if (hasMultica()) {
    if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
    if (!project) return NextResponse.json({ error: 'project required' }, { status: 400 })
    const ws = await store.getWorkspace(project)
    if (!ws?.multica_workspace_slug) return NextResponse.json({ error: 'no multica workspace bound to this project' }, { status: 400 })
    const multicaSlug = ws.multica_workspace_slug
    const { getIssuesAsContent, getContentCounts, getReviewQueueCounts } = await import('@/server/multica-db.js')
    const [items, counts, reviewers] = await Promise.all([
      getIssuesAsContent(multicaSlug, state),
      getContentCounts(multicaSlug),
      getReviewQueueCounts(multicaSlug),
    ])
    return NextResponse.json({
      items: items.map((i: Record<string, unknown>) => ({ ...i, project })),
      counts,
      reviewers,
      project: project || null,
    })
  }

  const fsState = state === 'review' ? undefined : state
  const items = collect({ project, state: fsState, agent })
  return NextResponse.json({
    items,
    counts: countsFor(project),
    reviewers: reviewerQueueCount(),
    project: project || null,
  })
}

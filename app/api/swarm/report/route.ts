import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { renderMcpReport, renderXReport } from '@/server/swarm-report.js'

function defaultRange() {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  return { from: start.toISOString(), to: now.toISOString() }
}

export async function GET(request: NextRequest) {
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })

  const params = request.nextUrl.searchParams
  const workspace = params.get('workspace') || ''
  if (!workspace) return NextResponse.json({ error: 'workspace required' }, { status: 400 })
  const range = defaultRange()
  const from = params.get('from') || range.from
  const to = params.get('to') || range.to
  const platform = params.get('platform') || 'x'
  const agent_key = params.get('agent_key') || ''
  const report_type = params.get('report_type') || (platform === 'mcp' ? 'mcp' : 'x')

  if (Number.isNaN(Date.parse(from))) return NextResponse.json({ error: 'from must be an ISO timestamp' }, { status: 400 })
  if (Number.isNaN(Date.parse(to))) return NextResponse.json({ error: 'to must be an ISO timestamp' }, { status: 400 })

  try {
    const report = report_type === 'mcp'
      ? await renderMcpReport({ workspace, agent_key, from, to })
      : await renderXReport({ workspace, agent_key, from, to, platform })
    return NextResponse.json(report)
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return NextResponse.json({ error: err.message }, { status: err.status || 500 })
  }
}

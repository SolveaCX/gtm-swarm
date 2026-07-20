import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { getDashboardSpec } from '@/server/swarm-store.js'
import { authorizeSwarmReadRequestForWorkspace } from '@/server/swarm-read-auth.js'
import { renderDashboardSpecReport, renderMcpReport, renderXReport } from '@/server/swarm-report.js'

const PRIVATE_REPORT_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
}

function reportJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: PRIVATE_REPORT_HEADERS })
}

function defaultRange() {
  const now = new Date()
  const start = new Date(now)
  start.setDate(now.getDate() - 7)
  start.setHours(0, 0, 0, 0)
  return { from: start.toISOString(), to: now.toISOString() }
}

function normalizeDayInput(day: string) {
  const value = day.trim()
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const isoPrefix = value.match(/^(\d{4}-\d{2}-\d{2})T/)
  if (isoPrefix) return isoPrefix[1]
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function dayRange(day: string) {
  const normalizedDay = normalizeDayInput(day)
  if (!normalizedDay) return null
  const from = new Date(`${normalizedDay}T00:00:00.000Z`)
  const to = new Date(`${normalizedDay}T23:59:59.999Z`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  return { from: from.toISOString(), to: to.toISOString() }
}

export async function GET(request: NextRequest) {
  if (!hasDB()) return reportJson({ error: 'GTM_DATABASE required' }, 503)

  const params = request.nextUrl.searchParams
  const workspace = params.get('workspace') || ''
  if (!workspace) return reportJson({ error: 'workspace required' }, 400)

  const auth = await authorizeSwarmReadRequestForWorkspace(request, workspace)
  if (!auth.ok) return reportJson({ error: auth.error }, auth.status)

  const platform = params.get('platform') || 'x'
  const agent_id = params.get('agent_id') || params.get('agentId') || ''
  const agent_key = params.get('agent_key') || ''
  const report_type = params.get('report_type') || (platform === 'mcp' ? 'mcp' : 'x')
  const date = params.get('date') || ''

  let from = ''
  let to = ''
  if (date) {
    const range = dayRange(date)
    if (!range) return reportJson({ error: 'date must be YYYY-MM-DD' }, 400)
    from = range.from
    to = range.to
  } else if (params.get('from') || params.get('to')) {
    const range = defaultRange()
    from = params.get('from') || range.from
    to = params.get('to') || range.to
  } else {
    const range = defaultRange()
    from = range.from
    to = range.to
  }

  if (Number.isNaN(Date.parse(from))) return reportJson({ error: 'from must be an ISO timestamp' }, 400)
  if (Number.isNaN(Date.parse(to))) return reportJson({ error: 'to must be an ISO timestamp' }, 400)

  try {
    let report
    if (report_type === 'mcp') {
      report = await renderMcpReport({ workspace, agent_id, agent_key, from, to })
    } else if (report_type === 'x') {
      report = await renderXReport({ workspace, agent_id, agent_key, from, to, platform })
    } else {
      const specRow = await getDashboardSpec({ workspace, agent_id, agent_key, platform, report_type: 'custom' })
      if (!specRow?.spec) return reportJson({ error: 'dashboard spec not found' }, 404)
      report = await renderDashboardSpecReport({
        workspace,
        agent_id: agent_id || specRow.agent_id,
        agent_key: agent_key || specRow.agent_key,
        from,
        to,
        platform: platform || specRow.platform,
        spec: specRow.spec,
      })
    }
    return reportJson(report)
  } catch (e: unknown) {
    const err = e as Error & { status?: number }
    return reportJson({ error: err.message }, err.status || 500)
  }
}

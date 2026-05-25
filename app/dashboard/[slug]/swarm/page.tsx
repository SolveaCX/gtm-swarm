'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { BarChart3, Check, Copy, RefreshCw } from 'lucide-react'
import './SwarmDashboard.css'

type LeaderboardRow = {
  artifact_id: string
  external_id: string
  url?: string
  title?: string
  body?: string
  observed_at?: string
  baseline_observed_at?: string
  metrics?: Record<string, number>
  current?: Record<string, number>
  baseline?: Record<string, number>
  delta?: Record<string, number>
}

type SwarmReport = {
  range: { from: string; to: string }
  agent_key?: string
  report_type?: string
  today_work: { post: number; reply: number }
  post_total_leaderboard: LeaderboardRow[]
  reply_total_leaderboard: LeaderboardRow[]
  post_delta_leaderboard: LeaderboardRow[]
  reply_delta_leaderboard: LeaderboardRow[]
}

type McpReport = {
  report_type: 'mcp'
  agent_key: string
  range: { from: string; to: string }
  summary: {
    total_calls: number
    error_calls: number
    error_rate: number
    business_success_rate: number
    active_client_instances: number
  }
  call_trend: Array<{ bucket: string; calls: number }>
  calls_by_tool: Array<{ label: string; count: number }>
  errors_by_tool: Array<{ label: string; count: number; total: number; rate: number }>
  latency_by_tool: Array<{ tool: string; p50_ms: number; p95_ms: number }>
  top_clients: Array<{ label: string; count: number }>
  error_types: Array<{ label: string; count: number }>
  business_success_by_tool: Array<{ label: string; count: number; total: number; rate: number }>
  source_catalogs: Array<{ label: string; count: number }>
  route_health: Array<{ label: string; requests: number; http_2xx: number; http_4xx: number; http_5xx: number }>
}

type BoundAgent = {
  id?: string
  name?: string
  channel?: string
  status?: string
}

type WorkspaceDetail = {
  swarm_token?: string
  agents?: BoundAgent[]
}

type DailyTarget = {
  id: string
  agent_key: string
  platform: string
  report_type: string
}

type DailyRun = {
  id: string
  day: string
  status: string
  agent_key: string
  platform: string
  report_type: string
  missing_reason?: string
  completed_at?: string
}

function localInputValue(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function isoFromLocalInput(value: string) {
  return new Date(value).toISOString()
}

function fmt(value?: number) {
  return Number(value || 0).toLocaleString()
}

function pct(value?: number) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="swarm-stat">
      <span>{label}</span>
      <strong>{fmt(value)}</strong>
    </div>
  )
}

function hasMcpData(report: SwarmReport | McpReport | null) {
  const mcp = report as McpReport | null
  if (!mcp || mcp.report_type !== 'mcp') return false
  return Boolean(
    mcp.summary?.total_calls ||
    mcp.call_trend?.length ||
    mcp.calls_by_tool?.length ||
    mcp.top_clients?.length ||
    mcp.route_health?.length
  )
}

function hasXData(report: SwarmReport | McpReport | null) {
  const x = report as SwarmReport | null
  if (!x || x.report_type === 'mcp') return false
  return Boolean(
    x.today_work?.post ||
    x.today_work?.reply ||
    x.post_total_leaderboard?.length ||
    x.reply_total_leaderboard?.length ||
    x.post_delta_leaderboard?.length ||
    x.reply_delta_leaderboard?.length
  )
}

function buildTelemetryExample(slug: string, reportType: 'x' | 'mcp', agentKey: string) {
  const stableAgentKey = agentKey || (reportType === 'mcp' ? 'mcp-agent-key' : 'x-publisher-agent')
  const artifactType = reportType === 'mcp' ? 'mcp_tool_call' : 'post'
  const externalId = reportType === 'mcp'
    ? '1766656800000-client_abc123-fetch_reviews-a8f21c'
    : 'x-post-1888888888888888888'
  const payload = reportType === 'mcp'
    ? {
      service_name: stableAgentKey,
      metric_name: 'mcp_tool_calls_total',
      tool: 'fetch_reviews',
      status: 'ok',
      client: 'claude-code',
      error_type: '',
      source_catalog: 'amazon-us',
      client_instance_id: 'client_abc123',
      business_success: true,
      route: 'POST /mcp',
      http_status: 200,
    }
    : {
      kind: 'post',
      text: 'launch update',
      url: 'https://x.com/example/status/1888888888888888888',
    }
  const metrics = reportType === 'mcp'
    ? { calls: 1, latency_ms: 842, business_success: 1, http_2xx: 1, http_4xx: 0, http_5xx: 0 }
    : { views: 1280, replies: 14 }

  return JSON.stringify({
    schema_version: 'swarm.telemetry.v1',
    workspace: slug,
    agent_key: stableAgentKey,
    node_id: 'local-runtime-01',
    sent_at: '2026-05-25T10:00:02Z',
    artifacts: [
      {
        platform: reportType === 'mcp' ? 'mcp' : 'x',
        artifact_type: artifactType,
        external_id: externalId,
        title: reportType === 'mcp' ? 'fetch_reviews ok' : 'launch update',
        created_at: '2026-05-25T10:00:00Z',
        payload,
      },
    ],
    observations: [
      {
        platform: reportType === 'mcp' ? 'mcp' : 'x',
        artifact_type: artifactType,
        external_id: externalId,
        observed_at: '2026-05-25T10:00:02Z',
        metrics,
      },
    ],
  }, null, 2)
}

function OnboardingPanel({
  slug,
  reportType,
  agentKey,
  swarmToken,
  copied,
  onCopyToken,
}: {
  slug: string
  reportType: 'x' | 'mcp'
  agentKey: string
  swarmToken: string
  copied: boolean
  onCopyToken: () => void
}) {
  const example = buildTelemetryExample(slug, reportType, agentKey)
  const curl = `curl -X POST https://gtm.shulex.com/api/swarm/ingest \\
  -H "Authorization: Bearer ${swarmToken || '<workspace swarm_token>'}" \\
  -H "Content-Type: application/json" \\
  --data @telemetry.json`

  return (
    <section className="swarm-onboarding">
      <div className="swarm-onboarding-head">
        <div>
          <span>Setup required</span>
          <h2>这个 agent 还没有接入报表数据</h2>
          <p>让 agent 按下面格式推送一次 telemetry，GTM Swarm 会自动存储并在本页按时间段聚合展示。</p>
        </div>
        <button className="swarm-copy-token" onClick={onCopyToken} disabled={!swarmToken}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied' : 'Copy token'}
        </button>
      </div>

      <div className="swarm-onboarding-grid">
        <div className="swarm-steps">
          <div>
            <strong>1. Endpoint</strong>
            <code>POST https://gtm.shulex.com/api/swarm/ingest</code>
          </div>
          <div>
            <strong>2. Auth</strong>
            <code>Authorization: Bearer &lt;workspace swarm_token&gt;</code>
          </div>
          <div>
            <strong>3. Identity</strong>
            <code>workspace={slug}</code>
            <code>agent_key={agentKey || (reportType === 'mcp' ? 'mcp-agent-key' : 'x-publisher-agent')}</code>
          </div>
          <div>
            <strong>4. Convention</strong>
            <code>platform={reportType === 'mcp' ? 'mcp' : 'x'}</code>
            <code>artifact_type={reportType === 'mcp' ? 'mcp_tool_call' : 'post / reply'}</code>
          </div>
        </div>

        <div className="swarm-code-block">
          <div className="swarm-code-title">telemetry.json</div>
          <pre>{example}</pre>
        </div>
      </div>

      <div className="swarm-code-block swarm-curl">
        <div className="swarm-code-title">push example</div>
        <pre>{curl}</pre>
      </div>
    </section>
  )
}

function SimpleTable({ title, rows, columns }: { title: string; rows: any[]; columns: Array<{ key: string; label: string; format?: (value: any, row: any) => string }> }) {
  return (
    <section className="swarm-board">
      <div className="swarm-board-head">
        <h2>{title}</h2>
        <span>{rows.length}</span>
      </div>
      <div className="swarm-table">
        <div className="swarm-row swarm-row-head" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
          {columns.map(col => <span key={col.key}>{col.label}</span>)}
        </div>
        {rows.length === 0 && <div className="swarm-empty">No data</div>}
        {rows.map((row, i) => (
          <div key={`${title}-${i}`} className="swarm-row" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
            {columns.map(col => <span key={col.key}>{col.format ? col.format(row[col.key], row) : String(row[col.key] ?? '')}</span>)}
          </div>
        ))}
      </div>
    </section>
  )
}

function Leaderboard({ title, rows, mode }: { title: string; rows: LeaderboardRow[]; mode: 'total' | 'delta' }) {
  return (
    <section className="swarm-board">
      <div className="swarm-board-head">
        <h2>{title}</h2>
        <span>{rows.length}</span>
      </div>
      <div className="swarm-table">
        <div className="swarm-row swarm-row-head">
          <span>Object</span>
          <span>Views</span>
          <span>Replies</span>
        </div>
        {rows.length === 0 && <div className="swarm-empty">No data</div>}
        {rows.map(row => {
          const values = mode === 'delta' ? row.delta : row.metrics
          const href = row.url || ''
          return (
            <a
              key={`${row.artifact_id}-${mode}`}
              className="swarm-row"
              href={href || undefined}
              target={href ? '_blank' : undefined}
              rel="noreferrer"
            >
              <span className="swarm-object">
                <strong>{row.title || row.external_id}</strong>
                <small>{row.external_id}</small>
              </span>
              <span>{fmt(values?.views)}</span>
              <span>{fmt(values?.replies)}</span>
            </a>
          )
        })}
      </div>
    </section>
  )
}

export default function SwarmDashboardPage() {
  const params = useParams()
  const slug = params?.slug as string
  const initialRange = useMemo(() => {
    const now = new Date()
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return { from: localInputValue(start), to: localInputValue(now) }
  }, [])
  const [from, setFrom] = useState(initialRange.from)
  const [to, setTo] = useState(initialRange.to)
  const [report, setReport] = useState<SwarmReport | McpReport | null>(null)
  const [agents, setAgents] = useState<BoundAgent[]>([])
  const [reportType, setReportType] = useState<'x' | 'mcp'>('mcp')
  const [agentKey, setAgentKey] = useState('')
  const [dailyTargets, setDailyTargets] = useState<DailyTarget[]>([])
  const [dailyRuns, setDailyRuns] = useState<DailyRun[]>([])
  const [swarmToken, setSwarmToken] = useState('')
  const [copiedToken, setCopiedToken] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({
        workspace: slug,
        platform: reportType === 'mcp' ? 'mcp' : 'x',
        report_type: reportType,
        from: isoFromLocalInput(from),
        to: isoFromLocalInput(to),
      })
      if (agentKey) qs.set('agent_key', agentKey)
      const response = await fetch(`/api/swarm/report?${qs}`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'report failed')
      setReport(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, agentKey, reportType])

  useEffect(() => {
    fetch(`/api/workspaces/${slug}`)
      .then(r => r.json())
      .then((d: WorkspaceDetail) => {
        if (d.swarm_token) setSwarmToken(d.swarm_token)
        if (Array.isArray(d.agents)) setAgents(d.agents)
      })
      .catch(() => {})
  }, [slug])

  useEffect(() => {
    const qs = new URLSearchParams({ workspace: slug, report_type: reportType, platform: reportType === 'mcp' ? 'mcp' : 'x' })
    fetch(`/api/swarm/daily-status?${qs}`)
      .then(r => r.json())
      .then(d => {
        const targets = Array.isArray(d.targets) ? d.targets : []
        setDailyTargets(targets)
        setDailyRuns(Array.isArray(d.runs) ? d.runs : [])
        if (!agentKey && targets[0]?.agent_key) setAgentKey(targets[0].agent_key)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, reportType])

  const latestRun = dailyRuns.find(run => !agentKey || run.agent_key === agentKey)
  const noTargets = dailyTargets.length === 0
  const reportHasData = reportType === 'mcp' ? hasMcpData(report) : hasXData(report)
  const showOnboarding = noTargets || (!loading && report !== null && !reportHasData)

  const copySwarmToken = async () => {
    if (!swarmToken || !navigator.clipboard) return
    await navigator.clipboard.writeText(swarmToken)
    setCopiedToken(true)
    window.setTimeout(() => setCopiedToken(false), 1600)
  }

  return (
    <div className="swarm-page">
      <div className="swarm-topbar">
        <Link href={`/dashboard/${slug}`} className="swarm-back">← dashboard</Link>
        <div className="swarm-title">
          <BarChart3 size={16} />
          <span>{slug}</span>
          <strong>Swarm Telemetry</strong>
        </div>
        <button className="swarm-refresh" onClick={load} disabled={loading}>
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <header className="swarm-header">
        <div>
          <h1>Swarm Reports</h1>
          <p>{reportType === 'mcp' ? 'MCP calls, errors, latency, clients, source catalogs, and route health.' : 'Posts, replies, historical totals, and selected-window deltas.'}</p>
        </div>
        <div className="swarm-range">
          <label>
            Report
            <select
              value={reportType}
              onChange={e => {
                const next = e.target.value as 'x' | 'mcp'
                setReportType(next)
                setAgentKey('')
              }}
            >
              <option value="mcp">MCP telemetry</option>
              <option value="x">X posts/replies</option>
            </select>
          </label>
          <label>
            Agent
            {reportType === 'mcp' ? (
              <select value={agentKey} onChange={e => setAgentKey(e.target.value)}>
                <option value="">All MCP targets</option>
                {dailyTargets.map(target => (
                  <option key={target.id} value={target.agent_key}>{target.agent_key}</option>
                ))}
              </select>
            ) : (
              <select value={agentKey} onChange={e => setAgentKey(e.target.value)}>
                <option value="">All bound agents</option>
                {agents.map(agent => {
                  const key = agent.name || agent.channel || agent.id || ''
                  if (!key) return null
                  return (
                    <option key={agent.id || key} value={key}>
                      {agent.name || agent.channel || key}
                    </option>
                  )
                })}
              </select>
            )}
          </label>
          <label>
            From
            <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
          </label>
          <label>
            To
            <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
          </label>
          <button onClick={load} disabled={loading}>Apply</button>
        </div>
      </header>

      {error && <div className="swarm-error">{error}</div>}

      {showOnboarding && (
        <OnboardingPanel
          slug={slug}
          reportType={reportType}
          agentKey={agentKey}
          swarmToken={swarmToken}
          copied={copiedToken}
          onCopyToken={copySwarmToken}
        />
      )}

      {reportType === 'mcp' && (
        <section className="swarm-daily-status">
          <div>
            <span>Daily Collection</span>
            <strong>{latestRun ? `${latestRun.day} · ${latestRun.status}` : 'No scheduled run yet'}</strong>
          </div>
          {latestRun?.missing_reason && <p>{latestRun.missing_reason}</p>}
        </section>
      )}

      {reportType === 'mcp' ? (
        <>
          <section className="swarm-stats">
            <StatCard label="Total Calls" value={(report as McpReport | null)?.summary?.total_calls || 0} />
            <StatCard label="Errors" value={(report as McpReport | null)?.summary?.error_calls || 0} />
            <StatCard label="Active Instances" value={(report as McpReport | null)?.summary?.active_client_instances || 0} />
            <div className="swarm-stat">
              <span>Business Success</span>
              <strong>{pct((report as McpReport | null)?.summary?.business_success_rate)}</strong>
            </div>
          </section>
          <div className="swarm-grid">
            <SimpleTable title="Calls by Tool" rows={(report as McpReport | null)?.calls_by_tool || []} columns={[{ key: 'label', label: 'Tool' }, { key: 'count', label: 'Calls', format: fmt }]} />
            <SimpleTable title="Error Rate by Tool" rows={(report as McpReport | null)?.errors_by_tool || []} columns={[{ key: 'label', label: 'Tool' }, { key: 'count', label: 'Errors', format: fmt }, { key: 'rate', label: 'Rate', format: pct }]} />
            <SimpleTable title="p50 / p95 Latency" rows={(report as McpReport | null)?.latency_by_tool || []} columns={[{ key: 'tool', label: 'Tool' }, { key: 'p50_ms', label: 'p50 ms', format: fmt }, { key: 'p95_ms', label: 'p95 ms', format: fmt }]} />
            <SimpleTable title="Top Clients" rows={(report as McpReport | null)?.top_clients || []} columns={[{ key: 'label', label: 'Client' }, { key: 'count', label: 'Calls', format: fmt }]} />
            <SimpleTable title="Error Types" rows={(report as McpReport | null)?.error_types || []} columns={[{ key: 'label', label: 'Type' }, { key: 'count', label: 'Count', format: fmt }]} />
            <SimpleTable title="Business Success by Tool" rows={(report as McpReport | null)?.business_success_by_tool || []} columns={[{ key: 'label', label: 'Tool' }, { key: 'count', label: 'Success', format: fmt }, { key: 'rate', label: 'Rate', format: pct }]} />
            <SimpleTable title="Source Catalogs" rows={(report as McpReport | null)?.source_catalogs || []} columns={[{ key: 'label', label: 'Catalog' }, { key: 'count', label: 'Calls', format: fmt }]} />
            <SimpleTable title="POST /mcp Route Health" rows={(report as McpReport | null)?.route_health || []} columns={[{ key: 'label', label: 'Route' }, { key: 'http_2xx', label: '2xx', format: fmt }, { key: 'http_4xx', label: '4xx', format: fmt }, { key: 'http_5xx', label: '5xx', format: fmt }]} />
          </div>
        </>
      ) : (
        <>
          <section className="swarm-stats">
            <StatCard label="Posts Today" value={(report as SwarmReport | null)?.today_work?.post || 0} />
            <StatCard label="Replies Today" value={(report as SwarmReport | null)?.today_work?.reply || 0} />
          </section>
          <div className="swarm-grid">
            <Leaderboard title="Posts Total Ranking" rows={(report as SwarmReport | null)?.post_total_leaderboard || []} mode="total" />
            <Leaderboard title="Replies Total Ranking" rows={(report as SwarmReport | null)?.reply_total_leaderboard || []} mode="total" />
            <Leaderboard title="Posts Delta Ranking" rows={(report as SwarmReport | null)?.post_delta_leaderboard || []} mode="delta" />
            <Leaderboard title="Replies Delta Ranking" rows={(report as SwarmReport | null)?.reply_delta_leaderboard || []} mode="delta" />
          </div>
        </>
      )}
    </div>
  )
}

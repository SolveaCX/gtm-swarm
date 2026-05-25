'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { BarChart3, RefreshCw } from 'lucide-react'
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
  const [agentKey, setAgentKey] = useState('voc-amazon-reviews-mcp')
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
      .then(d => {
        if (Array.isArray(d.agents)) setAgents(d.agents)
      })
      .catch(() => {})
  }, [slug])

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
                setAgentKey(next === 'mcp' ? 'voc-amazon-reviews-mcp' : '')
              }}
            >
              <option value="mcp">MCP telemetry</option>
              <option value="x">X posts/replies</option>
            </select>
          </label>
          <label>
            Agent
            {reportType === 'mcp' ? (
              <input value={agentKey} onChange={e => setAgentKey(e.target.value)} />
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

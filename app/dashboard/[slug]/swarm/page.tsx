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
  today_work: { post: number; reply: number }
  post_total_leaderboard: LeaderboardRow[]
  reply_total_leaderboard: LeaderboardRow[]
  post_delta_leaderboard: LeaderboardRow[]
  reply_delta_leaderboard: LeaderboardRow[]
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

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="swarm-stat">
      <span>{label}</span>
      <strong>{fmt(value)}</strong>
    </div>
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
  const [report, setReport] = useState<SwarmReport | null>(null)
  const [agents, setAgents] = useState<BoundAgent[]>([])
  const [agentKey, setAgentKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const qs = new URLSearchParams({
        workspace: slug,
        platform: 'x',
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
  }, [slug, agentKey])

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
          <p>Posts, replies, historical totals, and selected-window deltas.</p>
        </div>
        <div className="swarm-range">
          <label>
            Agent
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

      <section className="swarm-stats">
        <StatCard label="Posts Today" value={report?.today_work.post || 0} />
        <StatCard label="Replies Today" value={report?.today_work.reply || 0} />
      </section>

      <div className="swarm-grid">
        <Leaderboard title="Posts Total Ranking" rows={report?.post_total_leaderboard || []} mode="total" />
        <Leaderboard title="Replies Total Ranking" rows={report?.reply_total_leaderboard || []} mode="total" />
        <Leaderboard title="Posts Delta Ranking" rows={report?.post_delta_leaderboard || []} mode="delta" />
        <Leaderboard title="Replies Delta Ranking" rows={report?.reply_delta_leaderboard || []} mode="delta" />
      </div>
    </div>
  )
}

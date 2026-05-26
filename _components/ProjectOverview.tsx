'use client'
import { useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import Link from 'next/link'
import { useProjectMeta, useStrategyBrief, useAgents, type AgentEntry } from '@/_hooks/useStrategy'
import { getProjectOverviewCta } from '@/lib/project-overview-status.js'
import './ProjectOverview.css'

const STEP_LABELS: Record<number, string> = {
  1: 'Market Insight',
  2: 'User Insight',
  3: 'Competitor Analysis',
  4: 'Content Strategy',
}

export function ProjectOverview({ slug }: { slug: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [regenerating, setRegenerating] = useState<number | null>(null)
  const meta = useProjectMeta(slug, refreshKey)
  const agents = useAgents(slug)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)
  const brief = useStrategyBrief(slug, expandedStep)

  const regenerateBrief = async (step: number) => {
    setRegenerating(step)
    try {
      const r = await fetch(`/api/contentos/${slug}/run-with-cia?step=${step}`, { method: 'POST' }).then(r => r.json())
      if (r.error) alert('Regeneration failed: ' + r.error)
    } finally {
      setRegenerating(null)
      setRefreshKey(k => k + 1)
    }
  }

  if (!meta) return <div className="overview-loading">loading project…</div>

  const py = meta.project_yaml as Record<string, unknown> & {
    name?: string; url?: string; tagline?: string; category?: string
    contentos_agent?: { state?: string; built_at?: string; agents_hydrated?: number }
  }
  const totalBriefSize = meta.briefs.reduce((s, b) => s + b.size, 0)
  const stepsDone = meta.briefs.filter(b => b.exists).length
  const activeAgents = agents.filter(a => a.yaml?.activate !== false).length
  const totalDrafted = agents.reduce((s, a) => s + (a.metrics?.rolling_30d?.drafted || 0), 0)
  const totalApproved = agents.reduce((s, a) => s + (a.metrics?.rolling_30d?.approved || 0), 0)
  const state = py.contentos_agent?.state || 'not_started'
  const cta = getProjectOverviewCta({
    contentosState: state,
    currentStep: meta.state?.current_step || 0,
    stepsDone,
    slug,
  })

  return (
    <div className="overview" data-color-mode="light">
      <section className="ov-hero">
        <div className="ov-hero-left">
          <h2 className="ov-hero-title">{py.name || slug}</h2>
          <p className="ov-hero-tagline">{py.tagline || '—'}</p>
          <div className="ov-hero-meta">
            <span className="ov-hero-cat">{py.category}</span>
            {py.url && (
              <a href={py.url as string} target="_blank" rel="noreferrer">{(py.url as string).replace(/^https?:\/\//, '')} ↗</a>
            )}
            <span className={`ov-hero-state ov-state-${state}`}>{state.replace(/_/g, ' ')}</span>
          </div>
        </div>
        <div className="ov-hero-right">
          {cta.show && (
            <Link className="ov-cta" href={cta.href}>
              {cta.label}
            </Link>
          )}
        </div>
      </section>

      <section className="ov-kpis">
        <Kpi label="Strategy Briefs" value={`${stepsDone}/4`} sub={`${(totalBriefSize/1024).toFixed(1)} KB total`} />
        <Kpi label="Active Agents" value={`${activeAgents}/${agents.length}`} sub="of 11 hydrated" />
        <Kpi label="Drafted (30d)" value={String(totalDrafted)} sub={`${totalApproved} approved`} />
        <Kpi label="Built At" value={py.contentos_agent?.built_at ? py.contentos_agent.built_at.slice(0, 10) : '—'} sub={py.contentos_agent?.built_at ? py.contentos_agent.built_at.slice(11, 19) + ' UTC' : 'awaiting build'} />
      </section>

      <section className="ov-section" id="strategy-briefs">
        <header className="ov-section-head">
          <h3>📊 Strategy Briefs</h3>
          <span className="ov-section-sub">ContentOS Agent discovery output. Click any card to read the full brief.</span>
        </header>
        <div className="ov-briefs">
          {meta.briefs.map(b => {
            const isOpen = expandedStep === b.step
            return (
              <div key={b.step} className={`brief-card ${b.exists ? 'is-done' : 'is-missing'} ${isOpen ? 'is-open' : ''}`}>
                <button
                  className="brief-head"
                  onClick={() => setExpandedStep(isOpen ? null : (b.exists ? b.step : null))}
                  disabled={!b.exists}
                >
                  <span className="brief-num">{b.exists ? '✓' : b.step}</span>
                  <span className="brief-text">
                    <span className="brief-label">Step {b.step}: {STEP_LABELS[b.step]}</span>
                    <span className="brief-meta">
                      {b.exists ? `${(b.size/1024).toFixed(1)} KB · click to expand` : 'not yet generated'}
                    </span>
                  </span>
                  <span className="brief-chevron">{isOpen ? '▴' : '▾'}</span>
                  {b.exists && (
                    <span
                      onClick={e => { e.stopPropagation(); regenerateBrief(b.step) }}
                      style={{
                        fontSize: 11, padding: '2px 6px', marginLeft: 4,
                        color: 'var(--text-faint)', cursor: 'pointer',
                        borderRadius: 4, border: '1px solid var(--border)',
                        background: 'transparent', userSelect: 'none',
                      }}
                      title="基于 CIA 数据重新生成"
                    >
                      {regenerating === b.step ? '⟳' : '🔄'}
                    </span>
                  )}
                </button>
                {isOpen && brief?.step === b.step && (
                  <div className="brief-body">
                    <MDEditor.Markdown source={brief.content} style={{ background: 'transparent' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="ov-section">
        <header className="ov-section-head">
          <h3>🤖 Agents — {agents.length} hydrated</h3>
          <span className="ov-section-sub">11 GTM agents configured from Step 4 content-strategy. Click into reddit / blog tabs to see their output.</span>
        </header>
        <div className="ov-agents">
          {agents.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="ov-kpi">
      <span className="ov-kpi-label">{label}</span>
      <span className="ov-kpi-value">{value}</span>
      {sub && <span className="ov-kpi-sub">{sub}</span>}
    </div>
  )
}

function AgentCard({ agent }: { agent: AgentEntry }) {
  const y = agent.yaml || {}
  const m = agent.metrics?.rolling_30d || {}
  const active = y?.activate !== false
  return (
    <div className={`agent-card ${active ? '' : 'is-deactivated'}`}>
      <header className="agent-head">
        <span className="agent-id">{agent.id}</span>
        <span className={`agent-active agent-active-${active ? 'yes' : 'no'}`}>
          {active ? '● active' : '○ off'}
        </span>
      </header>
      <h4 className="agent-name">{agent.name || y.name || agent.id}</h4>
      <div className="agent-meta">
        <span>📡 {y.platform || '—'}</span>
        <span>· 🔧 {y.builder || 'TBD'}</span>
        <span>· 👁 {y.reviewer || 'TBD'}</span>
      </div>
      <p className="agent-goal">{y.goal || 'No goal set — run ContentOS Agent.'}</p>
      {y.kpi?.weekly_target && (
        <div className="agent-kpi">
          <strong>KPI</strong> · {y.kpi.weekly_target}
        </div>
      )}
      {y.topics && y.topics.length > 0 && (
        <details className="agent-topics">
          <summary>📚 {y.topics.length} topics</summary>
          <ul>
            {y.topics.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </details>
      )}
      <footer className="agent-metrics">
        <span className="am-pill">drafted {m.drafted || 0}</span>
        <span className="am-pill am-green">approved {m.approved || 0}</span>
        <span className="am-pill am-red">rejected {m.rejected || 0}</span>
        <span className="am-pill am-blue">published {m.published || 0}</span>
      </footer>
    </div>
  )
}

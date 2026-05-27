'use client'
import { useState } from 'react'
import MDEditor from '@uiw/react-md-editor'
import Link from 'next/link'
import {
  useProjectMeta,
  useStrategyBrief,
  useAgents,
  useRuntimeGuide,
  type AgentEntry,
  type AgentTemplate,
  type RuntimeGuideRow,
} from '@/_hooks/useStrategy'
import { getProjectOverviewCta } from '@/lib/project-overview-status.js'
import './ProjectOverview.css'

const STEP_LABELS: Record<number, string> = {
  1: 'Market Insight',
  2: 'User Insight',
  3: 'Competitor Analysis',
  4: 'Content Strategy',
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function ProjectOverview({ slug }: { slug: string }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [agentRefreshKey, setAgentRefreshKey] = useState(0)
  const [runtimeRefreshKey, setRuntimeRefreshKey] = useState(0)
  const [regenerating, setRegenerating] = useState<number | null>(null)
  const meta = useProjectMeta(slug, refreshKey)
  const agents = useAgents(slug, agentRefreshKey)
  const runtimeGuide = useRuntimeGuide(slug, runtimeRefreshKey)
  const [expandedStep, setExpandedStep] = useState<number | null>(null)
  const [runtimeModal, setRuntimeModal] = useState<RuntimeGuideRow | null>(null)
  const [agentModalOpen, setAgentModalOpen] = useState(false)
  const brief = useStrategyBrief(slug, expandedStep)

  const regenerateBrief = async (step: number) => {
    setRegenerating(step)
    try {
      const r = await fetch(`/api/contentos/${slug}/run-with-cia?step=${step}`, { method: 'POST' }).then(r => r.json())
      if (r.error) {
        alert('Regeneration failed: ' + r.error)
        return
      }
      const stepKeys: Record<number, string> = {
        1: '01-market-insight',
        2: '02-user-insight',
        3: '03-competitor-analysis',
        4: '04-content-strategy',
      }
      for (;;) {
        await sleep(2000)
        const stateRes = await fetch(`/api/contentos/${slug}/state`).then(r => r.json())
        const info = stateRes.state?.steps?.[stepKeys[step]]
        if (info?.status === 'done') break
        if (info?.status === 'failed') {
          alert('Regeneration failed: ' + (info.error || 'Unknown error'))
          break
        }
      }
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

      <RuntimeGuideSection
        guide={runtimeGuide}
        selected={runtimeModal}
        onConfigure={setRuntimeModal}
        onClose={() => setRuntimeModal(null)}
        onConfigured={() => setRuntimeRefreshKey(k => k + 1)}
        slug={slug}
      />

      <section className="ov-section">
        <header className="ov-section-head ov-section-head-actions">
          <div>
            <h3>🤖 Agents — {agents.length} hydrated</h3>
            <span className="ov-section-sub">Create workspace-visible Multica agents from GTM templates. Required env and local paths are shown before creation.</span>
          </div>
          <button className="ov-action" type="button" onClick={() => setAgentModalOpen(true)}>
            创建 Agent
          </button>
        </header>
        {runtimeGuide && (
          <AgentTemplateModal
            open={agentModalOpen}
            onClose={() => setAgentModalOpen(false)}
            templates={runtimeGuide.templates}
            machines={runtimeGuide.machines}
            rows={runtimeGuide.rows}
            slug={slug}
            onCreated={() => {
              setAgentRefreshKey(k => k + 1)
              setRuntimeRefreshKey(k => k + 1)
            }}
          />
        )}
        {!runtimeGuide && agentModalOpen && (
          <div className="ov-modal-backdrop">
            <div className="ov-modal">
              <header className="ov-modal-head">
                <h4>创建 Agent</h4>
                <button type="button" onClick={() => setAgentModalOpen(false)}>×</button>
              </header>
              <p className="ov-muted">Runtime 引导暂不可用，请先确认 GTM_DATABASE 和 Multica 配置。</p>
            </div>
          </div>
        )}
        <div className="ov-agents">
          {agents.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      </section>
    </div>
  )
}

function RuntimeGuideSection({
  guide,
  selected,
  onConfigure,
  onClose,
  onConfigured,
  slug,
}: {
  guide: ReturnType<typeof useRuntimeGuide>
  selected: RuntimeGuideRow | null
  onConfigure: (row: RuntimeGuideRow) => void
  onClose: () => void
  onConfigured: () => void
  slug: string
}) {
  return (
    <section className="ov-section">
      <header className="ov-section-head">
        <h3>Runtime 配置引导</h3>
        <span className="ov-section-sub">固定几个 Multica runtime，让用户选择机器并完成监听配置。</span>
      </header>
      {!guide ? (
        <div className="runtime-empty">Runtime 引导暂不可用</div>
      ) : (
        <div className="runtime-guide">
          {guide.rows.map(row => (
            <div key={row.channelKey} className="runtime-row">
              <div className="runtime-main">
                <span className="runtime-channel">{row.label} runtime</span>
                <span className="runtime-copy">已配置：</span>
                <span className={`runtime-machine ${row.runtimeDisplayName ? '' : 'is-missing'}`}>
                  {row.runtimeDisplayName || '未配置'}
                </span>
              </div>
              <span className={`runtime-status runtime-${row.runtimeId ? 'online' : 'pending'}`}>
                {row.runtimeId ? '已绑定' : '待配置'}
              </span>
              <button className="runtime-configure" type="button" onClick={() => onConfigure(row)}>
                {row.runtimeId ? '更换' : '去配置'}
              </button>
            </div>
          ))}
        </div>
      )}
      {guide && selected && (
        <RuntimeConfigModal
          key={selected.channelKey}
          row={selected}
          machines={guide.machines}
          slug={slug}
          onClose={onClose}
          onConfigured={onConfigured}
        />
      )}
    </section>
  )
}

function RuntimeConfigModal({
  row,
  machines,
  slug,
  onClose,
  onConfigured,
}: {
  row: RuntimeGuideRow
  machines: { key: string; name: string }[]
  slug: string
  onClose: () => void
  onConfigured: () => void
}) {
  const [machineKey, setMachineKey] = useState(row.machineKey || machines[0]?.key || '')
  const [newMachineName, setNewMachineName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const resolvedMachineKey = machineKey === 'new' ? newMachineName.trim() : machineKey
  const displayCommand = resolvedMachineKey
    ? row.command.replace(/--machine\s+\S+/, `--machine ${resolvedMachineKey}`)
    : row.command

  const submit = async () => {
    setSubmitting(true)
    try {
      const r = await fetch('/api/runtime/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: slug, channelKey: row.channelKey, machineKey: resolvedMachineKey }),
      }).then(r => r.json())
      if (r.error) alert(r.error)
      else {
        onConfigured()
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ov-modal-backdrop">
      <div className="ov-modal">
        <header className="ov-modal-head">
          <h4>{row.label} runtime 配置</h4>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <label className="ov-field">
          <span>机器名称</span>
          <select value={machineKey} onChange={e => setMachineKey(e.target.value)}>
            {machines.map(machine => (
              <option key={machine.key} value={machine.key}>{machine.name}</option>
            ))}
            <option value="new">新增机器</option>
          </select>
        </label>
        {machineKey === 'new' && (
          <label className="ov-field">
            <span>新机器名称</span>
            <input value={newMachineName} placeholder="machine-key" onChange={e => setNewMachineName(e.target.value)} />
          </label>
        )}
        <div className="ov-deps">
          <DependencyList label="Required env" items={row.requiredEnv} />
          <DependencyList label="Required paths" items={row.requiredPaths} />
        </div>
        <label className="ov-field">
          <span>监听命令</span>
          <textarea readOnly value={displayCommand} />
        </label>
        <footer className="ov-modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="ov-action" disabled={submitting || !resolvedMachineKey} onClick={submit}>
            {submitting ? '创建中…' : '生成配置任务'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function AgentTemplateModal({
  open,
  onClose,
  templates,
  machines,
  rows,
  slug,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  templates: AgentTemplate[]
  machines: { key: string; name: string }[]
  rows: RuntimeGuideRow[]
  slug: string
  onCreated: () => void
}) {
  const firstTemplate = templates[0]
  const [templateKey, setTemplateKey] = useState(firstTemplate?.key || '')
  const template = templates.find(t => t.key === templateKey) || firstTemplate
  const runtimeRow = rows.find(row => row.profileKey === template?.runtimeProfile)
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [machineKey, setMachineKey] = useState(runtimeRow?.machineKey || machines[0]?.key || '')
  const [submitting, setSubmitting] = useState(false)

  if (!open || !template) return null

  const submit = async () => {
    setSubmitting(true)
    try {
      const r = await fetch('/api/agents/from-template', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          project: slug,
          templateKey,
          name: name.trim(),
          model: model.trim(),
          machineKey,
        }),
      }).then(r => r.json())
      if (r.error) alert(r.error)
      else {
        onCreated()
        onClose()
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="ov-modal-backdrop">
      <div className="ov-modal">
        <header className="ov-modal-head">
          <h4>从模板创建 Agent</h4>
          <button type="button" onClick={onClose}>×</button>
        </header>
        <label className="ov-field">
          <span>Agent 模板</span>
          <select value={templateKey} onChange={e => {
            const next = templates.find(t => t.key === e.target.value)
            const nextRow = rows.find(row => row.profileKey === next?.runtimeProfile)
            setTemplateKey(e.target.value)
            setMachineKey(nextRow?.machineKey || machines[0]?.key || '')
            setName('')
            setModel('')
          }}>
            {templates.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </label>
        <label className="ov-field">
          <span>名称</span>
          <input value={name} placeholder={template.name} onChange={e => setName(e.target.value)} />
        </label>
        <label className="ov-field">
          <span>Model</span>
          <input value={model} placeholder={template.model} onChange={e => setModel(e.target.value)} />
        </label>
        <label className="ov-field">
          <span>Runtime 机器</span>
          <select value={machineKey} onChange={e => setMachineKey(e.target.value)}>
            {machines.map(machine => (
              <option key={machine.key} value={machine.key}>{machine.name}</option>
            ))}
          </select>
        </label>
        <p className="ov-muted">{template.description}</p>
        <div className="ov-deps">
          <DependencyList label="Skills" items={template.skills} />
          <DependencyList label="Required env" items={template.requiredEnv} />
          <DependencyList label="Required paths" items={template.requiredPaths} />
        </div>
        <footer className="ov-modal-actions">
          <button type="button" onClick={onClose}>取消</button>
          <button type="button" className="ov-action" disabled={submitting} onClick={submit}>
            {submitting ? '创建中…' : '创建 Agent'}
          </button>
        </footer>
      </div>
    </div>
  )
}

function DependencyList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="dep-box">
      <strong>{label}</strong>
      {items.length ? (
        <div className="dep-tags">
          {items.map(item => <span key={item}>{item}</span>)}
        </div>
      ) : (
        <span className="ov-muted">None</span>
      )}
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

'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import MDEditor from '@uiw/react-md-editor'
import { useToken, authHeaders } from '@/_hooks/useToken'
import { formatWizardAgentLabel, selectWizardStepAfterStateRefresh } from '@/lib/wizard-selection.js'
import '../../Wizard.css'

type StepKey = '01-market-insight' | '02-user-insight' | '03-competitor-analysis' | '04-content-strategy'
type StepInfo = {
  status: 'pending' | 'running' | 'done' | 'failed'
  output_file?: string
  size?: number
  started_at?: string
  completed_at?: string
  error?: string
}

const STEPS: { n: 1 | 2 | 3 | 4; key: StepKey; label: string; sub: string }[] = [
  { n: 1, key: '01-market-insight',      label: 'Market Insight',       sub: 'TAM · SAM · SOM · trends · timing' },
  { n: 2, key: '02-user-insight',        label: 'User Insight',         sub: 'ICP · pain · triggers · vocab' },
  { n: 3, key: '03-competitor-analysis', label: 'Competitor Analysis',  sub: 'Top 5 · positioning · gap · risks' },
  { n: 4, key: '04-content-strategy',    label: 'Content Strategy',     sub: 'Pillars · channels · 11-agent YAML' },
]

function fmtDuration(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

function stepDurationMs(info?: StepInfo) {
  if (!info?.started_at || !info?.completed_at) return null
  return new Date(info.completed_at).getTime() - new Date(info.started_at).getTime()
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default function Wizard() {
  const params = useParams()
  const slug = params?.slug as string
  const [state, setState] = useState<Record<StepKey, StepInfo>>({} as Record<StepKey, StepInfo>)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState<'idle' | 'running' | 'saving' | 'building'>('idle')
  const [editing, setEditing] = useState(false)
  const [building, setBuilding] = useState<{ output?: string; done?: boolean } | null>(null)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [agentCount, setAgentCount] = useState<number | null>(null)
  const runStartedAtRef = useRef<number | null>(null)
  const pollingStepRef = useRef<1 | 2 | 3 | 4 | null>(null)
  const [token] = useToken()

  const refreshState = useCallback(async (opts: { preserveCurrentStep?: boolean } = {}) => {
    if (!slug) return {} as Record<StepKey, StepInfo>
    const r = await fetch(`/api/contentos/${slug}/state`).then(r => r.json())
    const steps = r.state.steps || {}
    setState(steps)
    setCurrentStep(prev => selectWizardStepAfterStateRefresh({
      serverCurrentStep: r.state.current_step || 0,
      currentStep: prev,
      preserveCurrentStep: Boolean(opts.preserveCurrentStep),
    }) as 1 | 2 | 3 | 4)
    return steps
  }, [slug])

  const refreshAgentCount = useCallback(async () => {
    if (!slug) return
    try {
      const r = await fetch(`/api/workspaces/${slug}`).then(r => r.json())
      setAgentCount(Array.isArray(r.agents) ? r.agents.length : null)
    } catch {
      setAgentCount(null)
    }
  }, [slug])

  const loadStep = useCallback(async (step: 1 | 2 | 3 | 4) => {
    if (!slug) return
    const r = await fetch(`/api/contentos/${slug}/strategy?step=${step}`).then(r => r.json())
    setContent(r.content || '')
    setCurrentStep(step)
    setEditing(false)
  }, [slug])

  useEffect(() => { refreshState() }, [refreshState])
  useEffect(() => { refreshAgentCount() }, [refreshAgentCount])
  useEffect(() => { loadStep(currentStep) }, [currentStep, loadStep])

  useEffect(() => {
    if (loading !== 'running') { setElapsedMs(0); runStartedAtRef.current = null; return }
    runStartedAtRef.current = Date.now()
    const id = setInterval(() => {
      if (runStartedAtRef.current) setElapsedMs(Date.now() - runStartedAtRef.current)
    }, 250)
    return () => clearInterval(id)
  }, [loading])

  const waitForStep = useCallback(async (step: 1 | 2 | 3 | 4) => {
    const key = STEPS[step - 1].key
    while (true) {
      await sleep(2000)
      const steps = await refreshState({ preserveCurrentStep: true })
      const info = steps[key]
      if (info?.status === 'done') {
        await loadStep(step)
        return
      }
      if (info?.status === 'failed') {
        alert('Step run failed:\n' + (info.error || 'Unknown error'))
        return
      }
    }
  }, [refreshState, loadStep])

  useEffect(() => {
    if (!slug || loading !== 'idle') return
    const runningStep = STEPS.find(s => state[s.key]?.status === 'running')
    if (!runningStep || pollingStepRef.current === runningStep.n) return

    pollingStepRef.current = runningStep.n
    setCurrentStep(runningStep.n)
    setLoading('running')
    waitForStep(runningStep.n).finally(() => {
      pollingStepRef.current = null
      setLoading('idle')
    })
  }, [slug, state, loading, waitForStep])

  const runStep = async (step: 1 | 2 | 3 | 4) => {
    if (!slug) return
    setLoading('running')
    setCurrentStep(step)
    const r = await fetch(`/api/contentos/${slug}/run-step?step=${step}`, {
      method: 'POST', headers: { ...authHeaders(token) },
    }).then(r => r.json())
    if (r.error) {
      setLoading('idle')
      alert('Step run failed:\n' + r.error + (String(r.error).includes('Bearer') ? '\n\n→ Click 🔒 Sign in (top bar of Home / Dashboard).' : ''))
      return
    }
    await waitForStep(step)
    setLoading('idle')
  }

  const regenerateStep = async () => {
    if (!slug) return
    setLoading('running')
    const r = await fetch(`/api/contentos/${slug}/run-with-cia?step=${currentStep}`, {
      method: 'POST',
    }).then(r => r.json())
    if (r.error) {
      setLoading('idle')
      alert('Regeneration failed:\n' + r.error)
      return
    }
    await waitForStep(currentStep)
    setLoading('idle')
  }

  const saveEdit = async () => {
    if (!slug) return
    setLoading('saving')
    await fetch(`/api/contentos/${slug}/save-edit?step=${currentStep}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ content }),
    })
    setLoading('idle')
    setEditing(false)
  }

  const build = async () => {
    if (!slug) return
    setLoading('building')
    setBuilding({ output: `Hydrating ${agentCount ?? 'registered'} agents...` })
    const r = await fetch(`/api/contentos/${slug}/build`, {
      method: 'POST', headers: { ...authHeaders(token) },
    }).then(r => r.json())
    setLoading('idle')
    if (r.error) {
      setBuilding({ output: 'Build failed:\n' + r.error, done: false })
      return
    }
    setBuilding({ output: r.stdout || `Hydrated ${agentCount ?? 'registered'} agents.`, done: true })
  }

  const doneCount = STEPS.filter(s => state[s.key]?.status === 'done').length
  const allDone = doneCount === 4
  const stepInfo = state[STEPS[currentStep - 1].key]
  const stepDone = stepInfo?.status === 'done'
  const stepRunning = loading === 'running' || stepInfo?.status === 'running'
  const anyStepRunning = loading === 'running' || STEPS.some(s => state[s.key]?.status === 'running')
  const durations = STEPS.map(s => stepDurationMs(state[s.key])).filter((d): d is number => d !== null)
  const totalElapsedMs = durations.reduce((a, b) => a + b, 0)

  if (building?.done) {
    return (
      <div className="wizard wizard-success">
        <div className="success-burst">
          <div className="success-checkmark">✓</div>
          <h1>{formatWizardAgentLabel(agentCount, '')} Initialized</h1>
          <p className="success-sub">{slug} swarm is ready to run.</p>
          <pre className="success-log">{building.output}</pre>
          <div className="success-actions">
            <Link href={`/dashboard/${slug}`} className="btn btn-primary">Open Control Panel →</Link>
            <Link href="/" className="btn btn-ghost">Back to projects</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="wizard">
      <header className="wizard-header">
        <Link href="/" className="wizard-back">← projects</Link>
        <div className="wizard-title">
          <span className="wt-label">DISCOVERY</span>
          <h1>{slug}</h1>
          <span className="wt-progress">
            <span className="wt-pcount">{doneCount}/4</span>
            <span className="wt-pdots">
              {STEPS.map(s => (
                <span key={s.n} className={`wt-pdot wt-pdot-${state[s.key]?.status || 'pending'}`} />
              ))}
            </span>
          </span>
        </div>
        <div className="wizard-meta">
          {allDone ? '✓ Ready to build' : `Step ${currentStep} of 4`}
          {totalElapsedMs > 0 && <span className="wt-elapsed"> · {fmtDuration(totalElapsedMs)} total</span>}
          <Link href={`/dashboard/${slug}`} className="btn btn-ghost" style={{ fontSize: 12, marginLeft: 12 }}>跳过 →</Link>
        </div>
      </header>

      <div className="wizard-grid">
        <aside className="wizard-rail">
          {STEPS.map(s => {
            const info = state[s.key]
            const status = info?.status || 'pending'
            const isActive = currentStep === s.n
            const dur = stepDurationMs(info)
            return (
              <button
                key={s.n}
                className={`rail-step rail-step-${status} ${isActive ? 'is-active' : ''}`}
                onClick={() => setCurrentStep(s.n)}
              >
                <span className="rs-num">{status === 'done' ? '✓' : status === 'running' ? '⟳' : s.n}</span>
                <span className="rs-text">
                  <span className="rs-label">{s.label}</span>
                  <span className="rs-sub">{s.sub}</span>
                  {dur !== null && <span className="rs-dur">{fmtDuration(dur)}</span>}
                  {info?.size && <span className="rs-size">{(info.size / 1024).toFixed(1)}KB</span>}
                </span>
              </button>
            )
          })}

          {allDone && (
            <button className="rail-build-btn" onClick={build} disabled={loading === 'building'}>
              {loading === 'building' ? '⟳ Building…' : `⚡ ${formatWizardAgentLabel(agentCount, 'Build')}`}
            </button>
          )}
        </aside>

        <main className="wizard-main">
          {!stepDone && !stepRunning && (
            <div className="step-empty">
              <div className="empty-icon">▱▱▱▱</div>
              <h2>Step {currentStep}: {STEPS[currentStep - 1].label}</h2>
              <p>{STEPS[currentStep - 1].sub}</p>
              {stepInfo?.status === 'failed' && (
                <p className="running-hint">上次运行失败：{stepInfo.error || 'Unknown error'}</p>
              )}
              <button className="btn btn-primary" onClick={() => runStep(currentStep)} disabled={anyStepRunning}>
                Run ContentOS Agent →
              </button>
            </div>
          )}

          {stepRunning && (
            <div className="step-running">
              <div className="running-spinner">⟳</div>
              <h2>ContentOS Agent thinking...</h2>
              <p>Step {currentStep}: {STEPS[currentStep - 1].label}</p>
              <div className="running-elapsed">⏱ {fmtDuration(elapsedMs)}</div>
              <div className="running-hint">claude --print is assembling 40KB+ context. Usually 2-3 min.</div>
              <div className="running-bar">
                <div className="running-bar-fill" style={{ width: `${Math.min(95, elapsedMs / 1800)}%` }} />
              </div>
            </div>
          )}

          {stepDone && content && (
            <div className="step-done">
              <div className="step-toolbar">
                <div className="st-info">
                  <span className="st-size">{(content.length / 1024).toFixed(1)}KB</span>
                  <span className="st-status">✓ done</span>
                </div>
                <div className="st-actions">
                  {!editing ? (
                    <>
                      <button className="btn btn-ghost" onClick={() => setEditing(true)}>✏️ Edit</button>
                      <button className="btn btn-ghost" onClick={regenerateStep} disabled={anyStepRunning}>
                        🔄 重新生成
                      </button>
                      {currentStep < 4 ? (
                        <button className="btn btn-primary" onClick={() => runStep((currentStep + 1) as 2 | 3 | 4)} disabled={anyStepRunning}>
                          Approve & Run Step {currentStep + 1} →
                        </button>
                      ) : (
                        <button className="btn btn-primary" onClick={build} disabled={anyStepRunning}>
                          ⚡ {formatWizardAgentLabel(agentCount, 'Build')}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button className="btn btn-ghost" onClick={() => { setEditing(false); loadStep(currentStep) }}>Cancel</button>
                      <button className="btn btn-primary" onClick={saveEdit} disabled={loading === 'saving'}>
                        {loading === 'saving' ? 'Saving…' : '💾 Save Edit'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="step-content" data-color-mode="dark">
                {editing ? (
                  <MDEditor value={content} onChange={v => setContent(v || '')} height={700} preview="edit" />
                ) : (
                  <MDEditor.Markdown source={content} style={{ background: 'transparent' }} />
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

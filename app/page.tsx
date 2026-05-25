'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import './Home.css'

type Project = {
  name: string; slug: string; url: string | null; category: string
  tagline: string; status: string; primary_audience?: string
  lifecycle_state?: string; swarm_token?: string
}


const STATE_COLOR: Record<string, string> = {
  onboarding: '#f59e0b',
  strategy: '#3b82f6',
  engine_building: '#8b5cf6',
  active: '#10b981',
  paused: '#6b7280',
  archived: '#374151',
}

const STATE_LABEL: Record<string, string> = {
  onboarding: 'Onboarding',
  strategy: 'Strategy',
  engine_building: 'Building Engine',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
}

const LIFECYCLE_BG: Record<string, string> = {
  onboarding: '#fef3c7',
  strategy:   '#dbeafe',
  engine_building: '#ede9fe',
  active:     '#dcfce7',
  paused:     '#f3f4f6',
  archived:   '#f3f4f6',
}

const LIFECYCLE_COLOR: Record<string, string> = {
  onboarding: '#92400e',
  strategy:   '#1e40af',
  engine_building: '#5b21b6',
  active:     '#15803d',
  paused:     '#6b7280',
  archived:   '#374151',
}

function LifecycleBadge({ state }: { state: string }) {
  return (
    <span style={{
      background: LIFECYCLE_BG[state] || '#f3f4f6',
      color: LIFECYCLE_COLOR[state] || '#374151',
      fontSize: '12px',
      fontWeight: 600,
      padding: '4px 10px',
      borderRadius: '9999px',
      letterSpacing: '0.96px',
      textTransform: 'uppercase' as const,
    }}>
      {STATE_LABEL[state] || state}
    </span>
  )
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([])
  const [states, setStates] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [copiedSlug, setCopiedSlug] = useState('')

  const copySwarmToken = async (project: Project) => {
    if (!project.swarm_token) return
    await navigator.clipboard.writeText(project.swarm_token)
    setCopiedSlug(project.slug)
    window.setTimeout(() => setCopiedSlug(''), 1600)
  }

  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(d => {
      // Merge registry + discovered (filesystem projects not yet in registry)
      const regProjects: Record<string, Project> = d.registry?.projects || {}
      const discovered: string[] = d.discovered || []
      const merged: Record<string, Project> = { ...regProjects }
      for (const slug of discovered) {
        if (!merged[slug]) merged[slug] = { slug, name: slug, url: null, category: '', tagline: '', status: 'active' }
      }
      setProjects(Object.values(merged))
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!projects.length) return
    Promise.all(projects.map(p =>
      fetch(`/api/contentos/${p.slug}/state`).then(r => r.json())
        .then(d => [p.slug, d.state?.current_step || 0] as const)
        .catch(() => [p.slug, 0] as const)
    )).then(pairs => setStates(Object.fromEntries(pairs)))
  }, [projects])

  if (loading) return <div className="home-loading">loading projects...</div>

  return (
    <div className="home">
      <header className="home-hero">
        <h1>GTM Swarm</h1>
        <p className="hero-sub">Pick a product. ContentOS Agent runs market + user + competitor discovery. 11 GTM agents go live.</p>
        <Link href="/onboard" className="btn btn-primary">
          + New Product
        </Link>
      </header>

      <section className="project-grid">
        {projects.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '64px 0', color: 'var(--text-faint)' }}>
            <p style={{ marginBottom: 16 }}>No products yet.</p>
            <Link href="/onboard" className="btn btn-primary">+ Create your first product</Link>
          </div>
        )}
        {projects.map(p => {
          const step = states[p.slug] || 0
          const isStub = p.status === 'stub'
          const isBuilt = step >= 4
          const stepLabel = isBuilt ? 'Built · 11 agents live'
            : step === 0 ? 'Not started'
            : `Step ${step} / 4`
          return (
            <div
              key={p.slug}
              role="link"
              tabIndex={isStub ? -1 : 0}
              className={`project-card ${isStub ? 'is-stub' : ''} ${isBuilt ? 'is-built' : ''}`}
              onClick={() => {
                if (!isStub) window.location.href = isBuilt ? `/dashboard/${p.slug}` : `/wizard/${p.slug}`
              }}
              onKeyDown={e => {
                if (!isStub && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault()
                  window.location.href = isBuilt ? `/dashboard/${p.slug}` : `/wizard/${p.slug}`
                }
              }}
            >
              <div className="pc-header">
                <span className="pc-name">{p.name}</span>
                {p.lifecycle_state
                  ? <LifecycleBadge state={p.lifecycle_state} />
                  : <span className={`pc-status pc-status-${p.status}`}>{p.status}</span>
                }
              </div>
              <div className="pc-tagline">{p.tagline}</div>
              <div className="pc-meta">
                <span className="pc-category">{p.category}</span>
                {p.url && <span className="pc-url">{p.url.replace(/^https?:\/\//, '')}</span>}
              </div>
              <div className="pc-progress">
                <div className="pc-progress-track">
                  <div className="pc-progress-fill" style={{ width: `${(step / 4) * 100}%` }} />
                </div>
                <span className="pc-progress-label">{stepLabel}</span>
              </div>
              <div className="pc-cta">
                {isStub ? 'Awaiting brief →' : isBuilt ? 'Open dashboard →' : step === 0 ? 'Start discovery →' : 'Resume wizard →'}
              </div>
              {p.swarm_token && (
                <button
                  className="pc-token"
                  onClick={e => {
                    e.stopPropagation()
                    copySwarmToken(p)
                  }}
                  type="button"
                >
                  {copiedSlug === p.slug ? 'Copied' : 'Copy Swarm Token'}
                </button>
              )}
            </div>
          )
        })}
      </section>

      <footer className="home-footer">
        GTM Swarm v0.1 · {projects.length} projects · ContentOS Agent powered by Claude
      </footer>
    </div>
  )
}

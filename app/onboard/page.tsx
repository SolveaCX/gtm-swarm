'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToken, authHeaders } from '@/_hooks/useToken'
import { RefreshCw } from 'lucide-react'
import '../Wizard.css'

type Phase = 'input' | 'analyzing' | 'confirm' | 'creating' | 'done'

type Analysis = {
  name: string
  slug: string
  tagline: string
  category: string
  url: string
  audience: { primary: string; secondary: string }
  positioning: string
  competitors: string[]
  suggested_channels: string[]
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  height: 44,
  borderRadius: 8,
  border: '1px solid var(--border-strong)',
  background: 'var(--card)',
  color: 'var(--ink)',
  fontSize: 16,
  marginBottom: 20,
  boxSizing: 'border-box',
  outline: 'none',
  fontFamily: 'var(--sans)',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontWeight: 500,
  fontSize: 15,
  color: 'var(--ink)',
}

export default function Onboard() {
  const [phase, setPhase] = useState<Phase>('input')
  const [website, setWebsite] = useState('')
  const [githubKb, setGithubKb] = useState('')
  const [, setAnalysisId] = useState('')
  const [, setAnalysis] = useState<Analysis | null>(null)
  const [editedAnalysis, setEditedAnalysis] = useState<Analysis | null>(null)
  const [error, setError] = useState('')
  const [token] = useToken()
  const router = useRouter()

  const skipToManual = () => {
    setEditedAnalysis({
      name: '', slug: '', tagline: '', category: '',
      url: website, audience: { primary: '', secondary: '' },
      positioning: '', competitors: [], suggested_channels: ['reddit', 'x', 'blog'],
    })
    setPhase('confirm')
  }

  const runAnalysis = async () => {
    if (!website.trim()) { skipToManual(); return }
    setError('')
    setPhase('analyzing')
    const r = await fetch('/api/onboarding/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({ website, github_kb: githubKb || undefined }),
    }).then(r => r.json())
    if (r.error) { setError(r.error); setPhase('input'); return }
    const id = r.id
    setAnalysisId(id)
    let tries = 0
    const poll = setInterval(async () => {
      tries++
      const res = await fetch(`/api/onboarding/analysis/${id}`).then(r => r.json())
      if (res.status === 'done') {
        clearInterval(poll)
        setAnalysis(res.result)
        setEditedAnalysis({ ...res.result })
        setPhase('confirm')
      } else if (res.status === 'error' || tries > 30) {
        clearInterval(poll)
        setError(res.error || 'Analysis timed out')
        setPhase('input')
      }
    }, 2000)
  }

  const createProduct = async () => {
    if (!editedAnalysis) return
    setPhase('creating')
    const r = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
      body: JSON.stringify({
        slug: editedAnalysis.slug,
        name: editedAnalysis.name,
        urls: { website, github_kb: githubKb || undefined },
        project_config: editedAnalysis,
      }),
    }).then(r => r.json())
    if (r.error) { setError(r.error); setPhase('confirm'); return }
    setPhase('done')
    setTimeout(() => router.push(`/wizard/${editedAnalysis.slug}`), 1500)
  }

  if (phase === 'done') {
    return (
      <div className="wizard wizard-success">
        <div className="success-burst">
          <div className="success-checkmark">✓</div>
          <h1>Product Created</h1>
          <p style={{ color: 'var(--text-sub)', fontSize: 16 }}>Redirecting to ContentOS wizard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="wizard">
      <header className="wizard-header">
        <Link href="/" className="wizard-back">← projects</Link>
        <div className="wizard-title">
          <span className="wt-label">Onboarding</span>
          <h1>New Product</h1>
        </div>
      </header>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px' }}>
        {phase === 'input' && (
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 300, color: 'var(--ink)', margin: '0 0 8px', letterSpacing: '-0.32px' }}>
              Add a product
            </h2>
            <p style={{ color: 'var(--text-sub)', marginBottom: 32, fontSize: 16, lineHeight: 1.5 }}>
              填 URL 让 AI 自动分析，或者直接跳过手动填写。
            </p>
            {error && <p style={{ color: 'var(--red)', marginBottom: 16, fontSize: 15 }}>{error}</p>}
            <label style={labelStyle}>
              Website URL <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span>
            </label>
            <input
              type="url"
              value={website}
              onChange={e => setWebsite(e.target.value)}
              placeholder="https://your-product.com"
              style={inputStyle}
            />
            <label style={labelStyle}>
              GitHub KB URL <span style={{ fontWeight: 400, color: 'var(--text-faint)' }}>(optional)</span>
            </label>
            <input
              type="url"
              value={githubKb}
              onChange={e => setGithubKb(e.target.value)}
              placeholder="https://github.com/org/kb-repo"
              style={inputStyle}
            />
            <button className="btn btn-primary" onClick={runAnalysis} style={{ width: '100%' }}>
              {website.trim() ? 'AI 分析产品 →' : '手动填写 →'}
            </button>
            {website.trim() && (
              <button
                onClick={skipToManual}
                style={{ width: '100%', marginTop: 10, background: 'none', border: 'none', color: 'var(--text-sub)', fontSize: 14, cursor: 'pointer', padding: '6px 0' }}
              >
                跳过分析，直接手动填写 →
              </button>
            )}
          </div>
        )}

        {phase === 'analyzing' && (
          <div style={{ textAlign: 'center', paddingTop: 80 }} className="wizard-spinner">
            <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--ink)' }} />
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 300, color: 'var(--ink)', margin: 0 }}>
              Analyzing product...
            </h2>
            <p style={{ color: 'var(--text-sub)', margin: 0, fontSize: 15 }}>
              AI is scraping {website} and extracting GTM metadata.
            </p>
          </div>
        )}

        {phase === 'confirm' && editedAnalysis && (
          <div>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 32, fontWeight: 300, color: 'var(--ink)', margin: '0 0 24px', letterSpacing: '-0.32px' }}>
              新建产品
            </h2>
            {error && <p style={{ color: 'var(--red)', marginBottom: 16, fontSize: 15 }}>{error}</p>}
            {([
              { key: 'name', label: '产品名称', placeholder: 'Solvea' },
              { key: 'slug', label: 'Slug（URL）', placeholder: 'solvea' },
            ] as const).map(({ key, label, placeholder }) => (
              <div key={key}>
                <label style={labelStyle}>{label}</label>
                <input
                  value={(editedAnalysis as unknown as Record<string, string>)[key] || ''}
                  onChange={e => {
                    const val = key === 'slug'
                      ? e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-')
                      : e.target.value
                    setEditedAnalysis({ ...editedAnalysis, [key]: val })
                  }}
                  placeholder={placeholder}
                  style={inputStyle}
                />
              </div>
            ))}
            <button
              className="btn btn-primary"
              onClick={createProduct}
              disabled={!editedAnalysis.name?.trim() || !editedAnalysis.slug?.trim()}
              style={{ width: '100%' }}
            >
              创建产品 →
            </button>
          </div>
        )}

        {phase === 'creating' && (
          <div style={{ textAlign: 'center', paddingTop: 80 }} className="wizard-spinner">
            <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--ink)' }} />
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 24, fontWeight: 300, color: 'var(--ink)', margin: 0 }}>
              Creating product workspace...
            </h2>
          </div>
        )}
      </div>
    </div>
  )
}

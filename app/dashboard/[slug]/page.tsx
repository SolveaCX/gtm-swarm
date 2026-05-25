'use client'
import { useMemo, useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { User, Eye, Star, FileText, Archive, Send, BarChart3 } from 'lucide-react'
import { Header } from '@/_components/Header'
import { TabBar, type TabKey } from '@/_components/TabBar'
import { ContentTable } from '@/_components/ContentTable'
import { PreviewPane } from '@/_components/PreviewPane'
import { ProjectOverview } from '@/_components/ProjectOverview'
import { IdeasPool } from '@/_components/IdeasPool'
import { Ledger } from '@/_components/Ledger'
import { BindWorkspaceModal } from '@/_components/BindWorkspaceModal'
import { useContent } from '@/_hooks/useContent'
import { useProjects } from '@/_hooks/useProjects'
import { useRole } from '@/_hooks/useRole'
import { useToken, postJson } from '@/_hooks/useToken'
import { TokenGate } from '@/_components/TokenGate'
import '../../App.css'

const TAB_TO_STATE: Record<Exclude<TabKey, 'overview' | 'ledger' | 'north-star' | 'review'>, 'new-idea' | 'draft' | 'bank' | 'published'> = {
  ideas: 'new-idea',
  drafts: 'draft',
  bank: 'bank',
  published: 'published',
}

type CIAResult = {
  tagline?: string
  category?: string
  audience?: { primary?: string; secondary?: string }
  positioning?: string
  competitors?: string[]
  suggested_channels?: string[]
  analyzed_at?: string
}

type AgentRow = {
  id: string
  name: string
  channel: string
  status: string
  config: Record<string, unknown>
  metrics: Record<string, unknown>
  review_checklist: string[]
  dashboard_widgets: unknown[]
  kpi_defaults: Record<string, string>
}

const CHANNEL_ACCENT: Record<string, string> = {
  reddit: '#ff4500', x: '#1d9bf0', blog: '#16a34a',
  'kol-koc': '#d97706', video: '#dc2626',
}

function AgentChannelCard({ agent }: { agent: AgentRow }) {
  const accent = CHANNEL_ACCENT[agent.channel] || 'var(--text-sub)'
  const metrics30d = (agent.metrics as Record<string, Record<string, number>>)?.rolling_30d || {}
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: 16,
      minWidth: 160,
      flex: '0 0 auto',
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: agent.status === 'active' ? 'var(--green)' : 'var(--text-faint)',
        }} />
        <span style={{ fontWeight: 600, fontSize: 13, color: accent }}>{agent.name || agent.channel}</span>
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>{agent.status}</span>
      </div>
      {agent.kpi_defaults?.weekly_target && (
        <div style={{ fontSize: 11, color: 'var(--text-sub)', marginBottom: 8 }}>
          {agent.kpi_defaults.weekly_target}
        </div>
      )}
      {Object.keys(metrics30d).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 10 }}>
          {Object.entries(metrics30d).map(([k, v]) => (
            <div key={k} style={{ fontSize: 11, color: 'var(--text-sub)' }}>
              <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{v}</span> {k}
            </div>
          ))}
        </div>
      )}
      <button style={{
        fontSize: 12, padding: '5px 10px', borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--border-strong)', background: 'transparent',
        color: 'var(--text-sub)', cursor: 'pointer', width: '100%',
        fontFamily: 'var(--sans)',
      }}>
        查看队列
      </button>
    </div>
  )
}

const BANNER_ICON: Record<string, React.ReactNode> = {
  review:    <Eye size={14} />,
  drafts:    <FileText size={14} />,
  bank:      <Archive size={14} />,
  published: <Send size={14} />,
}

const BANNER_LABEL: Record<string, string> = {
  review: 'Pending Review',
  drafts: 'In-progress Drafts',
  bank: 'Approved + Bank',
  published: 'Published',
}

const BANNER_DESC: Record<string, string> = {
  drafts:    'Agent 正在执行的任务草稿，内容尚未送审。Reviewer 可在此直接审核。',
  review:    'Reviewer 待审队列。切换到 Reviewer 视图后可 inline Approve / Reject。角标红色 = 有待审内容。',
  bank:      '已通过审核的内容储备库，等待调度发布。',
  published: '已发布到对应平台的内容，作为历史记录保留。',
}

export default function App() {
  const params = useParams()
  const routeSlug = params?.slug as string | undefined
  const registry = useProjects()
  const defaultSlug = registry?.default || 'voc-ai'
  const slug = routeSlug || defaultSlug
  const [role, setRole] = useRole()
  const [token, setToken, clearToken] = useToken()

  const [tab, setTab] = useState<TabKey>('overview')

  const [wsData, setWsData] = useState<{
    lifecycle_state?: string
    multica_workspace_slug?: string | null
    agents?: AgentRow[]
    cia_result?: CIAResult | null
  } | null>(null)

  const fetchWsData = () => {
    fetch(`/api/workspaces/${slug}`)
      .then(r => r.json())
      .then(d => { if (d && !d.error) setWsData(d) })
      .catch(() => {})
  }

  useEffect(() => { fetchWsData() }, [slug])

  const requestedState = tab === 'overview' ? undefined
    : tab === 'review' ? undefined
    : (TAB_TO_STATE as Record<string, 'new-idea' | 'draft' | 'bank' | 'published' | undefined>)[tab]

  const { data, refresh } = useContent({ project: slug, state: requestedState })
  const items = data?.items ?? []
  const counts = data?.counts ?? { 'new-idea': 0, 'draft': 0, 'bank': 0, 'published': 0 }
  const reviewerQueueTotal = data?.reviewers
    ? Object.values(data.reviewers).reduce((a, b) => a + b, 0)
    : 0

  const filtered = useMemo(() => {
    if (tab === 'review') {
      return items.filter(it => it.state === 'draft' && it.multica_status !== 'cancelled')
    }
    if (tab === 'bank') {
      return items.filter(it => it.multica_status !== 'cancelled')
    }
    return items
  }, [items, tab])

  const [selectedId, setSelectedId] = useState<string>('')
  const selected = filtered.find(i => i.id === selectedId) ?? filtered[0]

  const tabCounts = {
    overview: null,
    'north-star': null,
    ledger: null,
    ideas: counts['new-idea'],
    drafts: counts.draft,
    review: reviewerQueueTotal,
    bank: counts.bank,
    published: counts.published,
  }

  const reviewAction = async (item: typeof items[number], action: 'approve' | 'reject', reason?: string) => {
    const isMultica = item.file?.startsWith('multica://')
    if (isMultica) {
      const r = await postJson<{ ok?: boolean; error?: string }>('/api/review-multica', { issue_id: item.id, action, reason: reason || '', project: slug }, token)
      if (r.error) alert('Review failed: ' + r.error)
    } else {
      const reviewer = (item.frontmatter.reviewer as string) || ''
      if (!reviewer) { alert('No reviewer in frontmatter'); return }
      const r = await postJson<{ ok?: boolean; error?: string }>('/api/review', { reviewer, id: item.id, action, reason: reason || '' }, token)
      if (r.error) alert('Review failed: ' + r.error)
    }
    refresh()
  }

  return (
    <div className="page">
      <div className="topbar">
        <Link href="/" className="topbar-back">← projects</Link>
        <div className="topbar-project">
          <span className="tp-label">PROJECT</span>
          <select
            value={slug}
            onChange={e => { window.location.href = `/dashboard/${e.target.value}` }}
            className="tp-select"
          >
            {registry && Object.values(registry.projects).map(p => (
              <option key={p.slug} value={p.slug}>
                {p.name} {p.status === 'stub' ? '(stub)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div className="topbar-role">
          <span className="tr-label">VIEW</span>
          <div className="tr-toggle">
            <button
              className={role === 'founder' ? 'is-active' : ''}
              onClick={() => setRole('founder')}
            ><User size={12} /> Founder</button>
            <button
              className={role === 'reviewer' ? 'is-active' : ''}
              onClick={() => setRole('reviewer')}
            ><Eye size={12} /> Reviewer</button>
          </div>
        </div>
        <TokenGate token={token} onSet={setToken} onClear={clearToken} />
        <a
          href="https://github.com/SolveaCX/gtm-swarm"
          target="_blank"
          rel="noreferrer"
          className="topbar-paperclip"
          title="Source on GitHub"
        >
          <Star size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          GitHub
        </a>
      </div>

      <Header onRefresh={refresh} />
      <TabBar active={tab} onChange={setTab} counts={tabCounts} />

      {wsData && wsData.multica_workspace_slug == null && (
        <BindWorkspaceModal slug={slug} onBound={() => { fetchWsData(); refresh() }} />
      )}

      {tab === 'overview' ? (
        <div>
          <ProjectOverview slug={slug} />
          {wsData?.cia_result && (
            <div style={{ padding: '0 24px 24px' }}>
              <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.96px', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 12 }}>
                CIA Insights
                {wsData.cia_result.analyzed_at && (
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>
                    · 分析于 {wsData.cia_result.analyzed_at.slice(0, 10)}
                  </span>
                )}
              </div>
              <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 16, boxShadow: 'var(--shadow-sm)', display: 'grid', gap: 8 }}>
                {wsData.cia_result.tagline && (
                  <div style={{ fontSize: 14, color: 'var(--ink)', fontStyle: 'italic' }}>"{wsData.cia_result.tagline}"</div>
                )}
                {wsData.cia_result.category && (
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                    <span style={{ color: 'var(--text-faint)' }}>Category </span>{wsData.cia_result.category}
                  </div>
                )}
                {wsData.cia_result.positioning && (
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                    <span style={{ color: 'var(--text-faint)' }}>Positioning </span>{wsData.cia_result.positioning}
                  </div>
                )}
                {wsData.cia_result.audience?.primary && (
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                    <span style={{ color: 'var(--text-faint)' }}>Audience </span>
                    {wsData.cia_result.audience.primary}
                    {wsData.cia_result.audience.secondary && ` · ${wsData.cia_result.audience.secondary}`}
                  </div>
                )}
                {wsData.cia_result.competitors && wsData.cia_result.competitors.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                    <span style={{ color: 'var(--text-faint)' }}>Competitors </span>
                    {wsData.cia_result.competitors.join(' · ')}
                  </div>
                )}
                {wsData.cia_result.suggested_channels && wsData.cia_result.suggested_channels.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                    <span style={{ color: 'var(--text-faint)' }}>Channels </span>
                    {wsData.cia_result.suggested_channels.join(' · ')}
                  </div>
                )}
              </div>
            </div>
          )}
          {wsData?.agents && wsData.agents.length > 0 && (
            <div style={{ padding: '0 24px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.96px', textTransform: 'uppercase', color: 'var(--text-faint)' }}>
                  Agent Channels
                </div>
                <Link
                  href={`/dashboard/${slug}/swarm`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 32,
                    padding: '0 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--ink)',
                    background: 'var(--card)',
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  <BarChart3 size={13} />
                  Swarm Reports
                </Link>
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {wsData.agents.map(agent => (
                  <AgentChannelCard key={agent.id} agent={agent} />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : tab === 'ledger' ? (
        <Ledger slug={slug} />
      ) : tab === 'ideas' ? (
        <IdeasPool
          items={items.filter(i => i.state === 'new-idea')}
          onPromote={async item => {
            const r = await postJson<{ ok?: boolean; topic?: string; error?: string }>('/api/promote-idea', { project: item.project, agent: item.agent, idea_id: item.id }, token)
            if (r.ok) alert('Drafted: ' + (r.topic || '').slice(0, 60))
            else alert('Promote failed: ' + (r.error || 'unknown') + (String(r.error || '').includes('401') ? ' — click Sign in (top bar).' : ''))
            refresh()
          }}
          onReject={async (item, reason) => {
            await postJson('/api/reject-idea', { project: item.project, agent: item.agent, idea_id: item.id, reason }, token)
            refresh()
          }}
          onCreateIdea={async (topic, angle, hook) => {
            const r = await postJson<{ ok?: boolean; error?: string }>('/api/create-idea', { project: slug, topic, angle, hook })
            if (!r.ok) alert('Failed to create idea: ' + (r.error || 'unknown'))
            refresh()
          }}
        />
      ) : (
        <div className="content-grid">
          <div className="content-main">
            <div className="state-banner">
              <span className="state-banner-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {BANNER_ICON[tab]}
                {BANNER_LABEL[tab] || tab}
              </span>
              <span className="state-banner-count">{filtered.length} items</span>
              {BANNER_DESC[tab] && (
                <span className="state-banner-hint">{BANNER_DESC[tab]}</span>
              )}
            </div>
            <ContentTable
              items={filtered}
              selectedId={selected?.id || ''}
              onSelect={setSelectedId}
              onReview={tab === 'review' ? reviewAction : undefined}
            />
          </div>
          <PreviewPane item={selected} />
        </div>
      )}
    </div>
  )
}

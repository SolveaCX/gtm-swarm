'use client'
import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import './ContentTable.css'
import type { ContentItem } from '@/_hooks/useContent'
import { multicaIssueUrl } from '@/lib/multica-links'

export type ReviewAction = 'approve' | 'reject'

export function ContentTable({
  items,
  selectedId,
  onSelect,
  onReview,
  multicaWorkspaceSlug,
}: {
  items: ContentItem[]
  selectedId: string
  onSelect: (id: string) => void
  onReview?: (item: ContentItem, action: ReviewAction, reason?: string) => Promise<void> | void
  multicaWorkspaceSlug?: string | null
}) {
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  if (items.length === 0) {
    return (
      <div className="dj-table-empty">
        <div className="empty-icon">▱▱▱</div>
        <p>No content in this state.</p>
        <p className="empty-hint">Run an agent or promote a New Idea.</p>
      </div>
    )
  }

  return (
    <div className="dj-table-wrap">
      <table className="dj-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>AGENT</th>
            <th>PLATFORM</th>
            <th>TOPIC</th>
            <th>HOOK</th>
            <th>STATE</th>
            {onReview && <th>ACTIONS</th>}
          </tr>
        </thead>
        <tbody>
          {items.map(it => {
            const fm = it.frontmatter
            const topic = (fm.topic as string) || it.preview.slice(0, 60)
            const hookType = (fm.hook_type as string) || '—'
            const platform = (fm.platform as string) || '—'
            const multicaUrl = multicaIssueUrl({ file: it.file, workspaceSlug: multicaWorkspaceSlug || '' })
            return (
              <tr
                key={it.id}
                className={it.id === selectedId ? 'is-selected' : ''}
                onClick={() => {
                  if (multicaUrl) {
                    window.open(multicaUrl, '_blank', 'noopener,noreferrer')
                    return
                  }
                  onSelect(it.id)
                }}
              >
                <td className="dj-td-index" title={it.id}>
                  <span className="dj-id-cell">
                    <span>{shorten(it.id)}</span>
                    {multicaUrl && (
                      <a
                        href={multicaUrl}
                        className="dj-multica-link"
                        target="_blank"
                        rel="noreferrer"
                        title="Open in Multica"
                        aria-label={`Open ${it.id} in Multica`}
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </span>
                </td>
                <td><span className="dj-type-pill">{it.agent}</span></td>
                <td><span className="dj-type-pill">{platform}</span></td>
                <td>
                  <div className="dj-td-title">{topic}</div>
                  <div className="dj-td-category">
                    {(fm.target_audience as string) || ''}
                  </div>
                </td>
                <td className="dj-td-core">{hookType}</td>
                <td><StatePill state={it.state} multicaStatus={it.multica_status} /></td>
                {onReview && (
                  <td>
                    {rejectingId === it.id ? (
                      <div className="reject-inline">
                        <input
                          autoFocus
                          placeholder="reason..."
                          value={reason}
                          onChange={e => setReason(e.target.value)}
                          className="reject-input"
                        />
                        <button
                          className="btn-mini btn-reject-confirm"
                          onClick={async e => {
                            e.stopPropagation()
                            await onReview(it, 'reject', reason || 'No reason')
                            setRejectingId(null); setReason('')
                          }}
                        >Send</button>
                        <button
                          className="btn-mini btn-cancel"
                          onClick={e => { e.stopPropagation(); setRejectingId(null) }}
                        >×</button>
                      </div>
                    ) : (
                      <div className="row-actions">
                        <button
                          className="btn-mini btn-approve"
                          onClick={async e => { e.stopPropagation(); await onReview(it, 'approve') }}
                          title="Approve → move to bank/"
                        >✓ Approve</button>
                        <button
                          className="btn-mini btn-reject"
                          onClick={e => { e.stopPropagation(); setRejectingId(it.id) }}
                          title="Reject → write anti-pattern"
                        >✗ Reject</button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function shorten(id: string) {
  if (id.length <= 20) return id
  return id.slice(0, 8) + '…' + id.slice(-10)
}

function StatePill({ state, multicaStatus }: { state: ContentItem['state']; multicaStatus?: string }) {
  if (multicaStatus) {
    const multicaMap: Record<string, { label: string; cls: string }> = {
      backlog:     { label: 'backlog',     cls: 'dj-pill-stocked' },
      todo:        { label: 'todo',        cls: 'dj-pill-stocked' },
      in_progress: { label: 'in progress', cls: 'dj-pill-active' },
      in_review:   { label: 'in review',   cls: 'dj-pill-review' },
      done:        { label: 'done',        cls: 'dj-pill-approved' },
      cancelled:   { label: 'cancelled',   cls: 'dj-pill-cancelled' },
    }
    const m = multicaMap[multicaStatus] || { label: multicaStatus, cls: 'dj-pill-stocked' }
    return <span className={`dj-pill ${m.cls}`}>{m.label}</span>
  }
  const map: Record<ContentItem['state'], { label: string; cls: string }> = {
    'new-idea':  { label: 'NEW IDEA',  cls: 'dj-pill-stocked' },
    'draft':     { label: 'DRAFT',     cls: 'dj-pill-stocked' },
    'bank':      { label: 'BANK',      cls: 'dj-pill-approved' },
    'published': { label: 'PUBLISHED', cls: 'dj-pill-approved' },
  }
  const m = map[state]
  return <span className={`dj-pill ${m.cls}`}>{m.label}</span>
}

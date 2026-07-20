'use client'
import { useEffect, useState } from 'react'

type MulticaWorkspace = { id: string; slug: string; name: string }

export function BindWorkspaceModal({
  slug,
  onBound,
  onViewAds,
}: {
  slug: string
  onBound: () => void
  onViewAds?: () => void
}) {
  const [workspaces, setWorkspaces] = useState<MulticaWorkspace[]>([])
  const [selected, setSelected] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/multica/workspaces')
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); return }
        setWorkspaces(d.workspaces || [])
        if (d.workspaces?.length) setSelected(d.workspaces[0].slug)
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  async function handleBind() {
    if (!selected) return
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`/api/workspaces/${slug}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ multica_workspace_slug: selected }),
      })
      const d = await r.json()
      if (d.error) { setError(d.error); return }
      onBound()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'grid', placeItems: 'center',
      zIndex: 200,
    }}>
      <div style={{
        background: 'var(--card)',
        borderRadius: 'var(--radius-lg)',
        padding: 32,
        width: 'min(480px, 90vw)',
        boxShadow: '0 30px 60px rgba(0,0,0,0.3)',
      }}>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8, color: 'var(--ink)' }}>
          绑定 Multica Workspace
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-sub)', marginBottom: 20, lineHeight: 1.6 }}>
          请为项目 <strong>{slug}</strong> 选择一个 Multica workspace 进行绑定。
          绑定后不可更改，所有 Agent 任务和内容均读写该 workspace。
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: 'var(--text-faint)', marginBottom: 20 }}>加载中…</div>
        ) : workspaces.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--red)', marginBottom: 20 }}>
            未找到可用的 Multica workspace。请先在 Multica 中创建 workspace。
          </div>
        ) : (
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              fontSize: 14,
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 12,
              background: 'var(--bg)',
              color: 'var(--ink)',
              fontFamily: 'var(--sans)',
            }}
          >
            {workspaces.map(ws => (
              <option key={ws.id} value={ws.slug}>{ws.name} ({ws.slug})</option>
            ))}
          </select>
        )}

        <div style={{
          fontSize: 11, color: 'var(--text-faint)', marginBottom: 20,
          background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)',
          borderRadius: 8, padding: '8px 12px',
        }}>
          ⚠️ 绑定后不可更改，请确认选择正确的 workspace。
        </div>

        {error && (
          <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          {onViewAds && (
            <button
              type="button"
              onClick={onViewAds}
              style={{
                padding: '10px 18px',
                background: 'transparent',
                color: 'var(--text-sub)',
                border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-pill)',
                fontSize: 13,
                cursor: 'pointer',
                fontFamily: 'var(--sans)',
              }}
            >
              先查看 Ads
            </button>
          )}
          <button
            disabled={!selected || saving || workspaces.length === 0}
            onClick={handleBind}
            style={{
              padding: '10px 24px',
              background: selected && !saving ? 'var(--ink)' : 'var(--border)',
              color: selected && !saving ? 'var(--bg)' : 'var(--text-faint)',
              border: 'none',
              borderRadius: 'var(--radius-pill)',
              fontSize: 14,
              fontWeight: 600,
              cursor: selected && !saving ? 'pointer' : 'default',
              fontFamily: 'var(--sans)',
            }}
          >
            {saving ? '绑定中…' : '确认绑定'}
          </button>
        </div>
      </div>
    </div>
  )
}

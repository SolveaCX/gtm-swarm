'use client'
import { useState } from 'react'
import './TokenGate.css'

export function TokenGate({
  token,
  onSet,
  onClear,
}: {
  token: string
  onSet: (t: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')

  const masked = token ? `${token.slice(0, 6)}…${token.slice(-4)}` : ''
  return (
    <>
      <button
        className={`tg-btn ${token ? 'is-set' : 'is-unset'}`}
        onClick={() => { setDraft(token); setOpen(true) }}
        title={token ? 'Authorized — click to manage' : 'Read-only — click to sign in'}
      >
        {token ? `🔓 ${masked}` : '🔒 Sign in'}
      </button>
      {open && (
        <div className="tg-modal-bg" onClick={() => setOpen(false)}>
          <div className="tg-modal" onClick={e => e.stopPropagation()}>
            <h3>Access Token</h3>
            <p className="tg-help">
              Swarm and Ads report reads require the current Workspace token. Write actions require <code>GTM_WRITES_TOKEN</code>.
            </p>
            <p className="tg-help-small">
              Other non-sensitive read-only pages remain public. Management tokens are never accepted for report reads.
            </p>
            <input
              autoFocus
              type="password"
              placeholder="Paste token..."
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="tg-input"
              onKeyDown={e => {
                if (e.key === 'Enter') { onSet(draft); setOpen(false) }
                if (e.key === 'Escape') setOpen(false)
              }}
            />
            <div className="tg-actions">
              {token && (
                <button className="tg-btn-clear" onClick={() => { onClear(); setOpen(false) }}>
                  Sign out
                </button>
              )}
              <button className="tg-btn-cancel" onClick={() => setOpen(false)}>Cancel</button>
              <button className="tg-btn-save" onClick={() => { onSet(draft); setOpen(false) }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

function installPoolMock(initialRow) {
  const queries = []
  let row = initialRow
  const originalConnect = pg.Pool.prototype.connect

  pg.Pool.prototype.connect = async () => ({
    query: async (sql, params = []) => {
      queries.push({ sql: String(sql), params })
      if (String(sql) === 'BEGIN' || String(sql) === 'COMMIT' || String(sql) === 'ROLLBACK') return { rows: [] }
      if (String(sql).includes('SELECT * FROM contentos_states') && String(sql).includes('FOR UPDATE')) {
        return { rows: row ? [row] : [] }
      }
      if (String(sql).includes('INSERT INTO contentos_states')) {
        row = { workspace_id: params[0], current_step: params[1], steps: JSON.parse(params[2]) }
        return { rows: [row] }
      }
      if (String(sql).includes('UPDATE contentos_states')) {
        row = { workspace_id: params[2], current_step: params[1], steps: JSON.parse(params[0]) }
        return { rows: [row] }
      }
      throw new Error(`unexpected query: ${sql}`)
    },
    release: () => {},
  })

  return {
    queries,
    get row() { return row },
    restore() { pg.Pool.prototype.connect = originalConnect },
  }
}

test('claimContentOSStepRun atomically claims a pending step and rejects a fresh duplicate', async () => {
  process.env.GTM_DATABASE = 'postgres://user:pass@localhost:5432/gtm_test'
  const mock = installPoolMock({
    workspace_id: 'workspace-1',
    current_step: 0,
    steps: { '01-market-insight': { status: 'pending' } },
  })

  try {
    const store = await import(`./store.js?claim=${Date.now()}`)

    const first = await store.claimContentOSStepRun('workspace-1', '01-market-insight', {
      now: new Date('2026-05-27T10:00:00.000Z'),
    })
    const second = await store.claimContentOSStepRun('workspace-1', '01-market-insight', {
      now: new Date('2026-05-27T10:01:00.000Z'),
    })

    assert.equal(first.started, true)
    assert.equal(second.started, false)
    assert.equal(mock.row.steps['01-market-insight'].status, 'running')
    assert.equal(mock.row.steps['01-market-insight'].started_at, '2026-05-27T10:00:00.000Z')
    assert.ok(mock.queries.some(q => q.sql.includes('FOR UPDATE')))
  } finally {
    mock.restore()
    delete process.env.GTM_DATABASE
  }
})

test('markContentOSStepDone updates DB state without filesystem state', async () => {
  process.env.GTM_DATABASE = 'postgres://user:pass@localhost:5432/gtm_test'
  const mock = installPoolMock({
    workspace_id: 'workspace-1',
    current_step: 0,
    steps: { '01-market-insight': { status: 'running', started_at: '2026-05-27T10:00:00.000Z' } },
  })

  try {
    const store = await import(`./store.js?done=${Date.now()}`)

    const result = await store.markContentOSStepDone('workspace-1', '01-market-insight', {
      currentStep: 1,
      outputFile: 'projects/acme/strategy/01-market-insight.md',
      size: 100,
      usage: { input_tokens: 10 },
      now: new Date('2026-05-27T10:02:00.000Z'),
    })

    assert.equal(result.steps['01-market-insight'].status, 'done')
    assert.equal(result.steps['01-market-insight'].output_file, 'projects/acme/strategy/01-market-insight.md')
    assert.equal(result.current_step, 1)
    assert.equal(mock.row.steps['01-market-insight'].usage.input_tokens, 10)
  } finally {
    mock.restore()
    delete process.env.GTM_DATABASE
  }
})

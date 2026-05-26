import test from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'

test('getOrCreateWorkspace ensures Boyuan is an admin member', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    const params = _params
    queries.push({ sql, params })

    if (sql.includes('INSERT INTO workspace')) return { rows: [{ id: 'workspace-1' }] }
    if (sql.includes('INSERT INTO "user"')) return { rows: [{ id: 'boyuan-user-1' }] }
    return { rows: [] }
  }

  try {
    const { getOrCreateWorkspace } = await import(`./multica-db.js?test=${Date.now()}`)

    const workspaceId = await getOrCreateWorkspace('acme', 'Acme')

    assert.equal(workspaceId, 'workspace-1')
    assert.ok(
      queries.some(({ sql, params }) =>
        sql.includes('INSERT INTO "user"') &&
        params.includes('boyuan@solvea.cx')
      ),
      'expected Boyuan user to be upserted'
    )
    assert.ok(
      queries.some(({ sql, params }) =>
        sql.includes('INSERT INTO member') &&
        params[0] === 'workspace-1' &&
        params[1] === 'boyuan-user-1' &&
        params[2] === 'admin'
      ),
      'expected Boyuan to be inserted as workspace admin'
    )
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})

test('upsertRuntimeBackedAgent creates agent with runtime_id and config', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    if (sql.includes('SELECT id FROM agent')) return { rows: [] }
    if (sql.includes('INSERT INTO agent')) return { rows: [{ id: 'agent-1' }] }
    return { rows: [] }
  }

  try {
    const { upsertRuntimeBackedAgent } = await import(`./multica-db.js?runtime=${Date.now()}`)
    const id = await upsertRuntimeBackedAgent('workspace-1', {
      name: 'GTM-Reddit',
      runtimeId: 'runtime-1',
      runtimeConfig: { gtm_channel: 'reddit' },
    })

    assert.equal(id, 'agent-1')
    assert.ok(queries.some(q => q.sql.includes('runtime_id') && q.params.includes('runtime-1')))
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})

test('createProposalIssue creates a typed Multica issue with labels', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    if (sql.includes('INSERT INTO issue_label') && _params.includes('gtm-proposal')) return { rows: [{ id: 'label-base' }] }
    if (sql.includes('INSERT INTO issue_label') && _params.includes('gtm-sop_change')) return { rows: [{ id: 'label-type' }] }
    if (sql.includes('INSERT INTO issue_to_label')) return { rows: [] }
    if (sql.includes('INSERT INTO issue')) return { rows: [{ id: 'issue-1' }] }
    return { rows: [] }
  }

  try {
    const { createProposalIssue } = await import(`./multica-db.js?proposal=${Date.now()}`)
    const issueId = await createProposalIssue('workspace-1', {
      title: '[sop_change] Prefer pain-first hooks',
      description: '## GTM Proposal',
      creatorId: 'bot-1',
      proposalType: 'sop_change',
      priority: 'medium',
    })

    assert.equal(issueId, 'issue-1')
    const issueWrite = queries.find(q => q.sql.includes('INSERT INTO issue\n'))
    assert.ok(issueWrite)
    assert.ok(issueWrite.params.includes('[sop_change] Prefer pain-first hooks'))
    assert.equal(issueWrite.params[3], 'backlog')

    const labelWrites = queries.filter(q => q.sql.includes('INSERT INTO issue_label'))
    assert.equal(labelWrites.length, 2)
    assert.ok(labelWrites.every(q => q.sql.includes('ON CONFLICT (workspace_id, name)')))
    assert.ok(labelWrites.some(q => q.params[1] === 'gtm-proposal' && q.params[2] === '#0ea5e9'))
    assert.ok(labelWrites.some(q => q.params[1] === 'gtm-sop_change' && q.params[2] === '#ef4444'))

    const labelLinks = queries.filter(q => q.sql.includes('issue_to_label'))
    assert.equal(labelLinks.length, 2)
    assert.ok(labelLinks.some(q => q.params[0] === 'issue-1' && q.params[1] === 'label-base'))
    assert.ok(labelLinks.some(q => q.params[0] === 'issue-1' && q.params[1] === 'label-type'))
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})

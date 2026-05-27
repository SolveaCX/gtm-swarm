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

test('registerRuntimeListener upserts runtime by workspace machine and profile', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    if (sql.includes('INSERT INTO runtime')) return { rows: [{ id: 'runtime-1' }] }
    return { rows: [] }
  }

  try {
    const { registerRuntimeListener } = await import(`./multica-db.js?listener=${Date.now()}`)
    const runtimeId = await registerRuntimeListener('workspace-1', {
      machineKey: 'boyuan-mac-mini',
      profile: 'local-x-runtime',
      capabilities: ['shell', 'x_automation'],
      status: 'online',
      health: { missingEnv: [] },
    })

    assert.equal(runtimeId, 'runtime-1')
    const write = queries.find(q => q.sql.includes('INSERT INTO runtime'))
    assert.ok(write)
    assert.ok(write.params.includes('boyuan-mac-mini'))
    assert.ok(write.params.includes('local-x-runtime'))
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})

test('createRuntimeSetupIssue creates issue assigned to no agent with setup label', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    if (sql.includes('INSERT INTO issue_label') && _params.includes('runtime-setup')) return { rows: [{ id: 'label-runtime' }] }
    if (sql.includes('INSERT INTO issue')) return { rows: [{ id: 'issue-1' }] }
    return { rows: [] }
  }

  try {
    const { createRuntimeSetupIssue } = await import(`./multica-db.js?setup=${Date.now()}`)
    const issueId = await createRuntimeSetupIssue('workspace-1', {
      creatorId: 'bot-1',
      title: 'Runtime registration needed',
      description: 'Run gtm runtime listen',
    })

    assert.equal(issueId, 'issue-1')
    assert.ok(queries.some(q => q.sql.includes('INSERT INTO issue_label') && q.params[1] === 'runtime-setup'))
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})

test('bindAgentsToRuntimeProfile attaches waiting agents to runtime id', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    return { rows: [{ id: 'agent-1' }] }
  }

  try {
    const { bindAgentsToRuntimeProfile } = await import(`./multica-db.js?bind=${Date.now()}`)
    const rows = await bindAgentsToRuntimeProfile('workspace-1', {
      profile: 'local-x-runtime',
      runtimeId: 'runtime-1',
    })

    assert.equal(rows.length, 1)
    const update = queries.find(q => q.sql.includes('UPDATE agent'))
    assert.ok(update)
    assert.ok(update.sql.includes("runtime_config->>'runtime_profile' = $2"))
    assert.deepEqual(update.params, ['workspace-1', 'local-x-runtime', 'runtime-1'])
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})

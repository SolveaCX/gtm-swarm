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

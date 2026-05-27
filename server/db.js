// server/db.js
import pg from 'pg'
const { Pool } = pg

let pool = null

export function hasDB() {
  return Boolean(process.env.GTM_DATABASE)
}

export function getPool() {
  if (!pool && hasDB()) {
    pool = new Pool({
      connectionString: process.env.GTM_DATABASE,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: Number(process.env.GTM_DATABASE_CONNECT_TIMEOUT_MS || 5000),
      query_timeout: Number(process.env.GTM_DATABASE_QUERY_TIMEOUT_MS || 30000),
      statement_timeout: Number(process.env.GTM_DATABASE_STATEMENT_TIMEOUT_MS || 30000),
    })
  }
  return pool
}

export async function query(sql, params = []) {
  const p = getPool()
  if (!p) throw new Error('No GTM_DATABASE set')
  const { rows } = await p.query(sql, params)
  return rows
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params)
  return rows[0] || null
}

export async function transaction(fn) {
  const p = getPool()
  if (!p) throw new Error('No GTM_DATABASE set')
  const client = await p.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

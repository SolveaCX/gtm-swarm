export function getConfig(overrides = {}) {
  return {
    server: overrides.server || process.env.GTM_SWARM_SERVER || 'http://localhost:8082',
    token: overrides.token || process.env.GTM_SWARM_TOKEN || '',
  }
}

export async function requestJson(path, { method = 'GET', body = null, config = getConfig() } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (config.token) headers.authorization = `Bearer ${config.token}`
  const response = await fetch(`${config.server.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

export function encodeQuery(params) {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') q.set(key, String(value))
  }
  return q.toString()
}

import { randomBytes, timingSafeEqual } from 'node:crypto'

export function generateSwarmToken() {
  return `gtms_${randomBytes(32).toString('hex')}`
}

function safeEqual(a, b) {
  if (!a || !b) return false
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function extractBearerToken(request) {
  const authHeader = request.headers.get('authorization') || ''
  return authHeader.replace(/^Bearer\s+/i, '').trim()
}

export function authorizeSwarmBearer({ bearer, workspaceToken, globalToken }) {
  if (globalToken && safeEqual(bearer, globalToken)) return true
  if (workspaceToken && safeEqual(bearer, workspaceToken)) return true
  return false
}

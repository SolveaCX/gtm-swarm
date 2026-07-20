import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { getWorkspace, rotateWorkspaceSwarmToken } from '@/server/store.js'
import { authorizeSwarmBearer, extractBearerToken } from '@/server/swarm-token.js'

function authorizeAdmin(request: NextRequest) {
  return authorizeSwarmBearer({
    bearer: extractBearerToken(request),
    workspaceToken: process.env.GTM_API_TOKEN,
  })
}

function privateJson(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

function adminAuthorizationError(request: NextRequest) {
  if (!process.env.GTM_API_TOKEN) {
    return privateJson({ error: 'token administration is not configured' }, 503)
  }
  if (!authorizeAdmin(request)) return privateJson({ error: 'unauthorized' }, 401)
  return null
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!hasDB()) return privateJson({ error: 'GTM_DATABASE required' }, 503)
  const authorizationError = adminAuthorizationError(request)
  if (authorizationError) return authorizationError

  const { slug } = await params
  const workspace = await getWorkspace(slug)
  if (!workspace) return privateJson({ error: 'not found' }, 404)
  return privateJson({ workspace: workspace.slug, swarm_token: workspace.swarm_token })
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  if (!hasDB()) return privateJson({ error: 'GTM_DATABASE required' }, 503)
  const authorizationError = adminAuthorizationError(request)
  if (authorizationError) return authorizationError

  const { slug } = await params
  const workspace = await getWorkspace(slug)
  if (!workspace) return privateJson({ error: 'not found' }, 404)

  const rotated = await rotateWorkspaceSwarmToken(slug, workspace.swarm_token)
  if (!rotated) return privateJson({ error: 'token changed; retry the rotation' }, 409)
  return privateJson({ ok: true, workspace: rotated.slug, swarm_token: rotated.swarm_token })
}

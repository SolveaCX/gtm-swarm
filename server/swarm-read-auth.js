import { getWorkspace } from './store.js'
import { authorizeSwarmBearer, extractBearerToken } from './swarm-token.js'

export function authorizeSwarmReadBearer({ bearer, workspaceToken }) {
  return authorizeSwarmBearer({ bearer, workspaceToken })
}

export async function authorizeSwarmReadRequestForWorkspace(request, workspaceSlug) {
  const workspace = await getWorkspace(workspaceSlug)
  if (!workspace) return { ok: false, status: 404, error: 'workspace not found' }

  const ok = authorizeSwarmReadBearer({
    bearer: extractBearerToken(request),
    workspaceToken: workspace.swarm_token,
  })
  if (!ok) return { ok: false, status: 401, error: 'unauthorized' }
  return { ok: true, workspace }
}

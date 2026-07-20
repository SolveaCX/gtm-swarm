const PUBLIC_WORKSPACE_FIELDS = [
  'id',
  'slug',
  'name',
  'lifecycle_state',
  'created_at',
  'updated_at',
  'cia_result',
  'multica_workspace_slug',
]

export const NO_STORE_HEADERS = Object.freeze({
  'Cache-Control': 'no-store',
})

export function publicWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object') return workspace
  return Object.fromEntries(
    PUBLIC_WORKSPACE_FIELDS
      .filter(key => Object.prototype.hasOwnProperty.call(workspace, key))
      .map(key => [key, workspace[key]]),
  )
}

export function publicWorkspaces(workspaces) {
  return (workspaces || []).map(publicWorkspace)
}

export async function ensureMulticaWorkspaceBinding({
  slug,
  name,
  store,
  multica,
  installAgentPackForWorkspace,
}) {
  let multicaWorkspace = await multica.getWorkspaceBySlug(slug)
  if (!multicaWorkspace) {
    await multica.getOrCreateWorkspace(slug, name)
    multicaWorkspace = await multica.getWorkspaceBySlug(slug)
  }

  const ws = await store.bindMulticaWorkspace(slug, slug)
  if (multicaWorkspace) {
    await installAgentPackForWorkspace(multicaWorkspace, { pack: 'gtm-core' })
  }
  return ws
}

import test from 'node:test'
import assert from 'node:assert/strict'

test('ensureMulticaWorkspaceBinding reuses existing same-slug Multica workspace', async () => {
  const calls = []
  const { ensureMulticaWorkspaceBinding } = await import('./workspace-provisioning.js')

  const ws = await ensureMulticaWorkspaceBinding({
    slug: 'flatkey',
    name: 'Flatkey',
    store: {
      bindMulticaWorkspace: async (slug, multicaSlug) => {
        calls.push(['bind', slug, multicaSlug])
        return { slug, name: 'Flatkey', multica_workspace_slug: multicaSlug }
      },
    },
    multica: {
      getWorkspaceBySlug: async slug => {
        calls.push(['lookup', slug])
        return { id: 'multica-workspace-1', slug, name: 'Flatkey Existing' }
      },
      getOrCreateWorkspace: async () => {
        calls.push(['create'])
        throw new Error('should not create when Multica workspace already exists')
      },
    },
    installAgentPackForWorkspace: async workspace => {
      calls.push(['install', workspace.id])
    },
  })

  assert.equal(ws.multica_workspace_slug, 'flatkey')
  assert.deepEqual(calls, [
    ['lookup', 'flatkey'],
    ['bind', 'flatkey', 'flatkey'],
    ['install', 'multica-workspace-1'],
  ])
})

test('ensureMulticaWorkspaceBinding creates same-slug Multica workspace when missing', async () => {
  const calls = []
  const { ensureMulticaWorkspaceBinding } = await import('./workspace-provisioning.js')

  const ws = await ensureMulticaWorkspaceBinding({
    slug: 'new-product',
    name: 'New Product',
    store: {
      bindMulticaWorkspace: async (slug, multicaSlug) => {
        calls.push(['bind', slug, multicaSlug])
        return { slug, name: 'New Product', multica_workspace_slug: multicaSlug }
      },
    },
    multica: {
      getWorkspaceBySlug: async slug => {
        calls.push(['lookup', slug])
        const created = calls.some(call => call[0] === 'create')
        return created ? { id: 'multica-workspace-2', slug, name: 'New Product' } : null
      },
      getOrCreateWorkspace: async (slug, name) => {
        calls.push(['create', slug, name])
        return 'multica-workspace-2'
      },
    },
    installAgentPackForWorkspace: async workspace => {
      calls.push(['install', workspace.id])
    },
  })

  assert.equal(ws.multica_workspace_slug, 'new-product')
  assert.deepEqual(calls, [
    ['lookup', 'new-product'],
    ['create', 'new-product', 'New Product'],
    ['lookup', 'new-product'],
    ['bind', 'new-product', 'new-product'],
    ['install', 'multica-workspace-2'],
  ])
})

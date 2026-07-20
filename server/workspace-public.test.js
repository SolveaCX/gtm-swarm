import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NO_STORE_HEADERS, publicWorkspace, publicWorkspaces } from './workspace-public.js'

test('public workspace serializers use an allowlist and never return unknown credentials', () => {
  const source = {
    id: 'workspace-1',
    slug: 'flatkey',
    name: 'Flatkey',
    swarm_token: 'gtms_secret',
    future_api_key: 'must-not-leak',
    project_config: { access_token: 'must-not-leak' },
  }
  const expected = { id: 'workspace-1', slug: 'flatkey', name: 'Flatkey' }
  assert.deepEqual(publicWorkspace(source), expected)
  assert.deepEqual(publicWorkspaces([source]), [expected])
  assert.equal(source.swarm_token, 'gtms_secret')
  assert.equal(NO_STORE_HEADERS['Cache-Control'], 'no-store')
})

test('public workspace routes and dashboard do not expose swarm tokens', () => {
  const projectsRoute = readFileSync(path.join(process.cwd(), 'app/api/projects/route.ts'), 'utf8')
  const workspaceRoute = readFileSync(path.join(process.cwd(), 'app/api/workspaces/[slug]/route.ts'), 'utf8')
  const workspacesRoute = readFileSync(path.join(process.cwd(), 'app/api/workspaces/route.ts'), 'utf8')
  const debugRoute = readFileSync(path.join(process.cwd(), 'app/api/debug/route.ts'), 'utf8')
  const home = readFileSync(path.join(process.cwd(), 'app/page.tsx'), 'utf8')
  const dashboard = readFileSync(path.join(process.cwd(), 'app/dashboard/[slug]/swarm/page.tsx'), 'utf8')

  assert.doesNotMatch(projectsRoute, /swarm_token:\s*ws\.swarm_token/)
  assert.match(workspaceRoute, /publicWorkspace\(ws\)/)
  assert.match(workspacesRoute, /publicWorkspace\(ws\)/)
  assert.match(projectsRoute, /NO_STORE_HEADERS/)
  assert.match(workspaceRoute, /NO_STORE_HEADERS/)
  assert.match(workspacesRoute, /NO_STORE_HEADERS/)
  assert.match(debugRoute, /NO_STORE_HEADERS/)
  assert.doesNotMatch(home, /Copy Swarm Token|project\.swarm_token/)
  assert.doesNotMatch(dashboard, /d\.swarm_token|setSwarmToken|copySwarmToken/)
})

test('workspace token reads and rotations require the independent management bearer', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/api/workspaces/[slug]/swarm-token/route.ts'), 'utf8')
  assert.match(route, /workspaceToken: process\.env\.GTM_API_TOKEN/)
  assert.match(route, /export async function GET/)
  assert.match(route, /export async function POST/)

  const getHandler = route.slice(route.indexOf('export async function GET'), route.indexOf('export async function POST'))
  const postHandler = route.slice(route.indexOf('export async function POST'))
  assert.match(getHandler, /adminAuthorizationError\(request\)/)
  assert.match(postHandler, /adminAuthorizationError\(request\)/)
  assert.doesNotMatch(postHandler, /workspaceToken: workspace\.swarm_token/)
  assert.match(postHandler, /rotateWorkspaceSwarmToken\(slug, workspace\.swarm_token\)/)
  assert.match(route, /'Cache-Control': 'private, no-store'/)
})

test('workspace token rotation records a secret-free audit event atomically', () => {
  const store = readFileSync(path.join(process.cwd(), 'server/store.js'), 'utf8')
  const start = store.indexOf('export async function rotateWorkspaceSwarmToken')
  const end = store.indexOf('\nexport async function ', start + 1)
  const rotate = store.slice(start, end)

  assert.match(rotate, /transaction\(async client/)
  assert.match(rotate, /INSERT INTO audit_log/)
  assert.match(rotate, /workspace\.swarm_token\.rotate/)
  assert.match(rotate, /JSON\.stringify\(\{ workspace: rotated\.slug \}\)/)
  assert.doesNotMatch(rotate, /JSON\.stringify\([^\n]*swarm_token/)
})

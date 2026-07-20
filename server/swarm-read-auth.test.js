import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { authorizeSwarmReadBearer } from './swarm-read-auth.js'

test('workspace read bearer is scoped to its own workspace token', () => {
  assert.equal(authorizeSwarmReadBearer({
    bearer: 'tenant-a-token',
    workspaceToken: 'tenant-a-token',
  }), true)
  assert.equal(authorizeSwarmReadBearer({
    bearer: 'tenant-b-token',
    workspaceToken: 'tenant-a-token',
  }), false)
})

test('unrelated management or tenant tokens cannot read another workspace report', () => {
  assert.equal(authorizeSwarmReadBearer({
    bearer: 'management-token',
    workspaceToken: 'tenant-a-token',
  }), false)
  assert.equal(authorizeSwarmReadBearer({
    bearer: '',
    workspaceToken: 'tenant-a-token',
  }), false)
})

test('read authorization does not reuse server management credentials', () => {
  const auth = readFileSync(path.join(process.cwd(), 'server/swarm-read-auth.js'), 'utf8')
  assert.doesNotMatch(auth, /GTM_API_TOKEN|GTM_WRITES_TOKEN/)
})

test('report route authorizes before resolving or rendering tenant data and disables shared caching', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/api/swarm/report/route.ts'), 'utf8')
  const authorizeAt = route.indexOf('await authorizeSwarmReadRequestForWorkspace(request, workspace)')
  const specAt = route.indexOf('await getDashboardSpec(')
  const xReportAt = route.indexOf('await renderXReport(')

  assert.ok(authorizeAt > 0)
  assert.ok(specAt > authorizeAt)
  assert.ok(xReportAt > authorizeAt)
  assert.match(route, /'Cache-Control': 'private, no-store'/)
  assert.match(route, /Vary: 'Authorization'/)
})

test('daily status authorizes before reading tenant target and run metadata', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/api/swarm/daily-status/route.ts'), 'utf8')
  const authorizeAt = route.indexOf('await authorizeSwarmReadRequestForWorkspace(request, workspace)')
  const targetsAt = route.indexOf('await ensureDailyTargetsFromArtifacts(')

  assert.ok(authorizeAt > 0)
  assert.ok(targetsAt > authorizeAt)
  assert.match(route, /'Cache-Control': 'private, no-store'/)
  assert.match(route, /Vary: 'Authorization'/)
})

test('both report UI callers forward the locally configured bearer token', () => {
  const adsPanel = readFileSync(path.join(process.cwd(), '_components/AdsPanel.tsx'), 'utf8')
  const swarmPage = readFileSync(path.join(process.cwd(), 'app/dashboard/[slug]/swarm/page.tsx'), 'utf8')

  assert.match(adsPanel, /headers: \{ Accept: 'application\/json', \.\.\.authHeaders\(token\) \}/)
  assert.match(swarmPage, /headers: \{ Accept: 'application\/json', \.\.\.authHeaders\(token\) \}/)
  assert.match(swarmPage, /fetch\(`\/api\/swarm\/daily-status\?\$\{qs\}`, \{[\s\S]*?\.\.\.authHeaders\(token\)/)
})

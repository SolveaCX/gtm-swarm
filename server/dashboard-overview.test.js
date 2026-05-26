import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test('dashboard overview omits duplicate Agent Channels but keeps Agents section', () => {
  const dashboardPage = readFileSync(path.join(process.cwd(), 'app', 'dashboard', '[slug]', 'page.tsx'), 'utf-8')
  const projectOverview = readFileSync(path.join(process.cwd(), '_components', 'ProjectOverview.tsx'), 'utf-8')

  assert.doesNotMatch(dashboardPage, /Agent Channels/)
  assert.match(projectOverview, /Agents —/)
})

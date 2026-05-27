import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test('run-with-cia route starts a background ContentOS job instead of awaiting the LLM run', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/api/contentos/[slug]/run-with-cia/route.ts'), 'utf-8')

  assert.match(route, /startContentOSStepJob/)
  assert.match(route, /await\s+startContentOSStepJob/)
  assert.doesNotMatch(route, /await\s+runContentOSStep/)
  assert.match(route, /status:\s*202/)
})

test('contentos state and strategy routes do not fall back to filesystem state or strategy docs', () => {
  const stateRoute = readFileSync(path.join(process.cwd(), 'app/api/contentos/[slug]/state/route.ts'), 'utf-8')
  const strategyRoute = readFileSync(path.join(process.cwd(), 'app/api/contentos/[slug]/strategy/route.ts'), 'utf-8')
  const saveRoute = readFileSync(path.join(process.cwd(), 'app/api/contentos/[slug]/save-edit/route.ts'), 'utf-8')

  assert.doesNotMatch(stateRoute, /\.contentos-state\.json/)
  assert.doesNotMatch(strategyRoute, /readFileSync|existsSync|PROJECTS_DIR/)
  assert.doesNotMatch(saveRoute, /writeFileSync|PROJECTS_DIR/)
  assert.match(strategyRoute, /getStrategyDoc/)
  assert.match(saveRoute, /saveStrategyDoc/)
})

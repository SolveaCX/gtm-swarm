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

test('cia result route starts a detached ContentOS missing-steps job instead of running LLM work in-process', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/api/cia/result/route.ts'), 'utf-8')

  assert.match(route, /startMissingContentOSStepsJob/)
  assert.doesNotMatch(route, /runMissingContentOSSteps/)
  assert.doesNotMatch(route, /setImmediate/)
})

test('cia result route updates existing CIA data and regenerates ContentOS by default', () => {
  const route = readFileSync(path.join(process.cwd(), 'app/api/cia/result/route.ts'), 'utf-8')
  const worker = readFileSync(path.join(process.cwd(), 'scripts/contentos-missing-worker.js'), 'utf-8')
  const contentos = readFileSync(path.join(process.cwd(), 'server/contentos.js'), 'utf-8')

  assert.match(route, /saveWorkspaceCIAResult\(body\.slug,\s*result\)/)
  assert.match(route, /regenerate_contentos/)
  assert.match(route, /force:\s*regenerateContentOS/)
  assert.match(route, /regenerate_contentos:\s*regenerateContentOS/)
  assert.match(worker, /--force/)
  assert.match(contentos, /runMissingContentOSSteps\(slug,\s*options\s*=\s*\{\}\)/)
  assert.match(contentos, /const force = Boolean\(options\.force\)/)
  assert.match(contentos, /if \(force \|\| !existing\)/)
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

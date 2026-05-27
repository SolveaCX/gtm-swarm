import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test('contentos job registry does not read or write JSON state files', () => {
  const source = readFileSync(path.join(process.cwd(), 'server/contentos-jobs.js'), 'utf-8')

  assert.doesNotMatch(source, /\.contentos-state\.json/)
  assert.doesNotMatch(source, /\breadFileSync\b/)
  assert.doesNotMatch(source, /\bwriteFileSync\b/)
})

test('contentos job registry does not run the LLM worker inside the request process', () => {
  const source = readFileSync(path.join(process.cwd(), 'server/contentos-jobs.js'), 'utf-8')

  assert.doesNotMatch(source, /import \{ runContentOSStep \}/)
  assert.doesNotMatch(source, /await\s+runner\(/)
  assert.doesNotMatch(source, /runContentOSStep\(/)
  assert.doesNotMatch(source, /new Map\(/)
  assert.match(source, /detached:\s*true/)
})

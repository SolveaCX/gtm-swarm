import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test('wizard running state explains agent progress with intermediate phases', () => {
  const page = readFileSync(path.join(process.cwd(), 'app/wizard/[slug]/page.tsx'), 'utf-8')
  const css = readFileSync(path.join(process.cwd(), 'app/Wizard.css'), 'utf-8')

  assert.match(page, /RUNNING_PHASES/)
  assert.match(page, /Preparing project context/)
  assert.match(page, /Reading dependency briefs/)
  assert.match(page, /Calling streaming LLM/)
  assert.match(page, /Saving strategy brief/)
  assert.match(page, /running-phase-list/)
  assert.match(page, /running-phase-active/)

  assert.match(css, /\.running-phase-list/)
  assert.match(css, /\.running-phase-active/)
  assert.match(css, /\.running-phase-index/)
})

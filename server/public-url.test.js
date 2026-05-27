import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const RUNTIME_FILES = [
  'server/cron.js',
  'bin/gtm.js',
  'bin/gtm-digest.js',
]

test('runtime public URL fallbacks use the canonical GTM domain', () => {
  for (const file of RUNTIME_FILES) {
    const source = readFileSync(file, 'utf8')
    assert.doesNotMatch(source, /gtm-swarm-production-b9ff\.up\.railway\.app/, file)
    assert.match(source, /https:\/\/gtm\.shulex\.com/, file)
  }
})

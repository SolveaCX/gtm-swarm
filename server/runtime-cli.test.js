import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

test('gtm runtime plan prints a registration plan', () => {
  const result = spawnSync('node', ['bin/gtm.js', 'runtime', 'plan', '--workspace', 'voc-ai'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf-8',
  })

  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout)
  assert.equal(parsed.workspace, 'voc-ai')
  assert.ok(parsed.items.length > 0)
  assert.match(parsed.items[0].command, /gtm runtime listen --machine/)
})

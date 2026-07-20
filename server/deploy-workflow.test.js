import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

test('deploy workflow resets the deploy clone before building', () => {
  const workflow = readFileSync(path.join(process.cwd(), '.github/workflows/deploy.yml'), 'utf-8')

  assert.doesNotMatch(workflow, /git pull origin main/)
  assert.match(workflow, /git fetch origin main/)
  assert.match(workflow, /git reset --hard origin\/main/)
  assert.match(workflow, /git clean -fd/)
})

test('deploy workflow keeps production runtime writes outside the git checkout', () => {
  const workflow = readFileSync(path.join(process.cwd(), '.github/workflows/deploy.yml'), 'utf-8')

  assert.match(workflow, /mkdir -p "\$\{PROJECT_DIR\}\/data"/)
  assert.match(workflow, /echo "GTM_DATA_DIR=\$\{PROJECT_DIR\}\/data"/)
})

test('deploy workflow provisions the configured admin token for protected token management', () => {
  const workflow = readFileSync(path.join(process.cwd(), '.github/workflows/deploy.yml'), 'utf-8')

  assert.match(workflow, /GTM_API_TOKEN: \$\{\{ secrets\.GTM_API_TOKEN \}\}/)
  assert.match(workflow, /envs: .*GTM_API_TOKEN/)
  assert.match(workflow, /echo "GTM_API_TOKEN=\$\{GTM_API_TOKEN\}"/)
})

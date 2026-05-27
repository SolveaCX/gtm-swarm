import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

const dataDir = mkdtempSync(path.join(tmpdir(), 'gtm-swarm-contentos-jobs-'))
process.env.GTM_DATA_DIR = dataDir

after(() => {
  delete process.env.GTM_DATA_DIR
  rmSync(dataDir, { recursive: true, force: true })
})

function makeProject(slug) {
  const projectDir = path.join(dataDir, 'projects', slug)
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(path.join(projectDir, 'project.yaml'), `slug: ${slug}\nname: Acme\n`)
  return { dataDir, projectDir, slug }
}

function readState(projectDir) {
  return JSON.parse(readFileSync(path.join(projectDir, '.contentos-state.json'), 'utf-8'))
}

test('startContentOSStepJob starts one background run and reports duplicate triggers as already running', async () => {
  const { slug } = makeProject('acme-start')
  let resolveRun
  let runCount = 0
  const runner = async () => {
    runCount += 1
    await new Promise(resolve => { resolveRun = resolve })
    return { step: 1, file: 'projects/acme/strategy/01-market-insight.md', size: 100 }
  }

  try {
    const { startContentOSStepJob, getContentOSStepJob } = await import(`./contentos-jobs.js?test=${Date.now()}`)

    const first = startContentOSStepJob(slug, 1, { runner })
    const second = startContentOSStepJob(slug, 1, { runner })

    assert.equal(first.started, true)
    assert.equal(first.status, 'running')
    assert.equal(second.started, false)
    assert.equal(second.status, 'running')
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(runCount, 1)
    assert.equal(getContentOSStepJob(slug, 1)?.status, 'running')

    resolveRun()
    await first.promise

    assert.equal(getContentOSStepJob(slug, 1), null)
  } finally {
  }
})

test('startContentOSStepJob marks the step failed when the background run rejects', async () => {
  const { projectDir, slug } = makeProject('acme-fail')
  const runner = async () => {
    throw new Error('upstream timeout')
  }

  try {
    const { startContentOSStepJob, getContentOSStepJob } = await import(`./contentos-jobs.js?test=${Date.now()}`)

    const job = startContentOSStepJob(slug, 2, { runner })
    assert.equal(job.started, true)

    await job.promise

    const state = readState(projectDir)
    assert.equal(state.steps['02-user-insight'].status, 'failed')
    assert.equal(state.steps['02-user-insight'].error, 'upstream timeout')
    assert.match(state.steps['02-user-insight'].completed_at, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(getContentOSStepJob(slug, 2), null)
    assert.equal(existsSync(path.join(projectDir, 'project.yaml')), true)
  } finally {
  }
})

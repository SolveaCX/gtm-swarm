import { spawn } from 'node:child_process'
import path from 'node:path'
import { REPO_ROOT } from './paths.js'
import * as store from './store.js'

const STEPS = [
  { n: 1, slug: '01-market-insight' },
  { n: 2, slug: '02-user-insight' },
  { n: 3, slug: '03-competitor-analysis' },
  { n: 4, slug: '04-content-strategy' },
]

export function getContentOSStepJob(slug, stepNumber) {
  return null
}

function launchContentOSStepWorker(slug, stepNumber) {
  const child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, 'scripts/contentos-step-worker.js'), slug, String(stepNumber)],
    {
      cwd: REPO_ROOT,
      env: process.env,
      detached: true,
      stdio: 'ignore',
    }
  )
  child.unref()
  return child.pid || null
}

function launchMissingContentOSStepsWorker(slug, options = {}) {
  const args = [path.join(REPO_ROOT, 'scripts/contentos-missing-worker.js'), slug]
  if (options.force) args.push('--force')
  const child = spawn(
    process.execPath,
    args,
    {
      cwd: REPO_ROOT,
      env: process.env,
      detached: true,
      stdio: 'ignore',
    }
  )
  child.unref()
  return child.pid || null
}

export async function startContentOSStepJob(slug, stepNumber, options = {}) {
  const step = STEPS[stepNumber - 1]
  if (!step) throw new Error('step must be 1..4')

  const ws = await store.getWorkspace(slug)
  if (!ws) throw new Error(`workspace not found: ${slug}`)

  const claim = await store.claimContentOSStepRun(ws.id, step.slug)
  if (!claim.started) {
    return {
      slug,
      step: stepNumber,
      status: 'running',
      started: false,
      promise: null,
    }
  }

  const launcher = options.launcher || launchContentOSStepWorker
  const job = {
    slug,
    step: stepNumber,
    status: 'running',
    started: true,
    started_at: claim.state.steps?.[step.slug]?.started_at || new Date().toISOString(),
    pid: null,
  }

  try {
    job.pid = launcher(slug, stepNumber)
  } catch (e) {
    await store.markContentOSStepFailed(ws.id, step.slug, {
      error: e.message,
    })
    throw e
  }
  return job
}

export async function startMissingContentOSStepsJob(slug, options = {}) {
  const ws = await store.getWorkspace(slug)
  if (!ws) throw new Error(`workspace not found: ${slug}`)

  const launcher = options.launcher || launchMissingContentOSStepsWorker
  return {
    slug,
    status: 'running',
    force: Boolean(options.force),
    pid: launcher(slug, { force: Boolean(options.force) }),
  }
}

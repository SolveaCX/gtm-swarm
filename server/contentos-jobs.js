import path from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { PROJECTS_DIR } from './paths.js'
import { hasDB } from './db.js'
import * as store from './store.js'
import { runContentOSStep } from './contentos.js'

const STEPS = [
  { n: 1, slug: '01-market-insight' },
  { n: 2, slug: '02-user-insight' },
  { n: 3, slug: '03-competitor-analysis' },
  { n: 4, slug: '04-content-strategy' },
]

const jobs = new Map()

function jobKey(slug, step) {
  return `${slug}:${step}`
}

function initialState() {
  return {
    current_step: 0,
    steps: Object.fromEntries(STEPS.map(step => [step.slug, { status: 'pending' }])),
  }
}

function loadState(projectDir) {
  const file = path.join(projectDir, '.contentos-state.json')
  if (!existsSync(file)) return initialState()
  const state = JSON.parse(readFileSync(file, 'utf-8'))
  state.steps = { ...initialState().steps, ...(state.steps || {}) }
  return state
}

async function syncStateToDB(slug, state) {
  if (!hasDB()) return
  try {
    const ws = await store.getWorkspace(slug)
    if (ws) {
      await store.saveContentOSState(ws.id, {
        current_step: state.current_step,
        steps: state.steps,
      })
    }
  } catch (e) {
    console.warn('[contentos-jobs] DB state sync failed (non-fatal):', e.message)
  }
}

function saveState(projectDir, state) {
  state.last_updated = new Date().toISOString()
  writeFileSync(path.join(projectDir, '.contentos-state.json'), JSON.stringify(state, null, 2))
}

async function setStepStatus(slug, stepNumber, patch) {
  const step = STEPS[stepNumber - 1]
  const projectDir = path.join(PROJECTS_DIR, slug)
  const state = loadState(projectDir)
  state.steps[step.slug] = {
    ...(state.steps[step.slug] || {}),
    ...patch,
  }
  saveState(projectDir, state)
  await syncStateToDB(slug, state)
}

export function getContentOSStepJob(slug, stepNumber) {
  return jobs.get(jobKey(slug, stepNumber)) || null
}

export function startContentOSStepJob(slug, stepNumber, options = {}) {
  const key = jobKey(slug, stepNumber)
  const existing = jobs.get(key)
  if (existing) {
    return { ...existing, started: false }
  }

  const runner = options.runner || runContentOSStep
  const job = {
    slug,
    step: stepNumber,
    status: 'running',
    started: true,
    started_at: new Date().toISOString(),
    promise: null,
  }

  const promise = (async () => {
    try {
      await setStepStatus(slug, stepNumber, {
        status: 'running',
        started_at: job.started_at,
        error: undefined,
      })
      job.result = await runner(slug, stepNumber)
      job.status = 'done'
    } catch (e) {
      job.status = 'failed'
      job.error = e.message
      await setStepStatus(slug, stepNumber, {
        status: 'failed',
        error: e.message,
        completed_at: new Date().toISOString(),
      })
    } finally {
      jobs.delete(key)
    }
  })()

  job.promise = promise
  jobs.set(key, job)
  return job
}

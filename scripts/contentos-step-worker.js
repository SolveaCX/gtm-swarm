#!/usr/bin/env node
import { runContentOSStep } from '../server/contentos.js'
import * as store from '../server/store.js'

const STEPS = [
  { n: 1, slug: '01-market-insight' },
  { n: 2, slug: '02-user-insight' },
  { n: 3, slug: '03-competitor-analysis' },
  { n: 4, slug: '04-content-strategy' },
]

async function main() {
  const [, , slug, stepRaw] = process.argv
  const stepNumber = Number(stepRaw)
  const step = STEPS[stepNumber - 1]
  if (!slug || !step) throw new Error('usage: contentos-step-worker.js <slug> <step 1..4>')

  const ws = await store.getWorkspace(slug)
  if (!ws) throw new Error(`workspace not found: ${slug}`)

  try {
    const result = await runContentOSStep(slug, stepNumber)
    await store.markContentOSStepDone(ws.id, step.slug, {
      currentStep: stepNumber,
      outputFile: result.file,
      size: result.size,
      usage: result.usage || null,
    })
  } catch (e) {
    await store.markContentOSStepFailed(ws.id, step.slug, {
      error: e.message,
    })
    throw e
  }
}

main().catch(e => {
  console.error('[contentos-step-worker]', e?.stack || e?.message || e)
  process.exit(1)
})

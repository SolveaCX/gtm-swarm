#!/usr/bin/env node
import { runMissingContentOSSteps } from '../server/contentos.js'

async function main() {
  const [, , slug] = process.argv
  if (!slug) throw new Error('usage: contentos-missing-worker.js <slug>')

  await runMissingContentOSSteps(slug)
}

main().catch(e => {
  console.error('[contentos-missing-worker]', e?.stack || e?.message || e)
  process.exit(1)
})

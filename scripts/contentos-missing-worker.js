#!/usr/bin/env node
import { runMissingContentOSSteps } from '../server/contentos.js'

async function main() {
  const [, , slug, ...args] = process.argv
  if (!slug) throw new Error('usage: contentos-missing-worker.js <slug>')

  await runMissingContentOSSteps(slug, { force: args.includes('--force') })
}

main().catch(e => {
  console.error('[contentos-missing-worker]', e?.stack || e?.message || e)
  process.exit(1)
})

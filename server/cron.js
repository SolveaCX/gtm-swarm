import cron from 'node-cron'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PROJECTS_DIR } from './paths.js'
import { sourceIdeas } from './source-ideas.js'
import { hasAnthropic } from './llm.js'
import { buildDailyDigest, formatDigestMarkdown } from './digest.js'
import { hasDingTalk, pushMarkdown } from './dingtalk.js'
import { createDailyRuns, markMissingDailyRuns } from './swarm-store.js'
import { previousUtcDay } from './swarm-daily.js'

const SCHEDULE = process.env.GTM_IDEAS_CRON || '0 8 * * *'  // daily 08:00 UTC
const SWARM_DAILY_SCHEDULE = process.env.GTM_SWARM_DAILY_CRON || '15 0 * * *'
const SWARM_MISSING_SCHEDULE = process.env.GTM_SWARM_MISSING_CRON || '0 12 * * *'
const IDEAS_PER_AGENT = parseInt(process.env.GTM_IDEAS_PER_AGENT || '5', 10)
const ENABLED = process.env.GTM_CRON_ENABLED !== 'false'

function builtProjects() {
  if (!existsSync(PROJECTS_DIR)) return []
  return readdirSync(PROJECTS_DIR)
    .filter(n => !n.startsWith('_') && !n.startsWith('.'))
    .filter(n => {
      const f = path.join(PROJECTS_DIR, n, '.contentos-state.json')
      if (!existsSync(f)) return false
      try {
        const s = JSON.parse(readFileSync(f, 'utf-8'))
        return s?.steps?.['04-content-strategy']?.status === 'done'
      } catch { return false }
    })
}

async function runDailyIdeas() {
  const ts = new Date().toISOString()
  console.log(`[cron ${ts}] daily Ideas Pool refresh begin`)
  if (!hasAnthropic()) {
    console.log(`[cron] skipped — ANTHROPIC_API_KEY not set`)
    return
  }
  const slugs = builtProjects()
  if (!slugs.length) {
    console.log(`[cron] no built projects`)
    return
  }
  for (const slug of slugs) {
    try {
      const out = await sourceIdeas({ project: slug, n: IDEAS_PER_AGENT })
      console.log(`[cron] ${slug}: +${out.total} ideas (${out.log.join(' / ')})`)
    } catch (e) {
      console.error(`[cron] ${slug} failed:`, e?.message || e)
    }
  }
  // After ideas are generated, push a digest to DingTalk (silent if not configured)
  if (hasDingTalk()) {
    try {
      const publicUrl = process.env.GTM_PUBLIC_URL || 'https://gtm-swarm-production-b9ff.up.railway.app'
      const digest = buildDailyDigest({ sinceHours: 24, publicUrl })
      const md = formatDigestMarkdown(digest)
      await pushMarkdown(`GTM Swarm Daily — ${digest.ts.slice(0, 10)}`, md)
    } catch (e) {
      console.error('[cron] dingtalk digest failed:', e?.message || e)
    }
  }
  console.log(`[cron ${new Date().toISOString()}] daily Ideas Pool refresh end`)
}

export function startCron() {
  if (!ENABLED) {
    console.log(`[cron] disabled via GTM_CRON_ENABLED=false`)
    return
  }
  if (!cron.validate(SCHEDULE)) {
    console.error(`[cron] invalid schedule: ${SCHEDULE}`)
    return
  }
  cron.schedule(SCHEDULE, () => { runDailyIdeas().catch(e => console.error('[cron] uncaught:', e)) }, { timezone: 'UTC' })
  console.log(`[cron] scheduled: ${SCHEDULE} UTC · IDEAS_PER_AGENT=${IDEAS_PER_AGENT}`)

  if (cron.validate(SWARM_DAILY_SCHEDULE)) {
    cron.schedule(SWARM_DAILY_SCHEDULE, () => {
      runDailySwarmCollections().catch(e => console.error('[cron] swarm daily uncaught:', e))
    }, { timezone: 'UTC' })
    console.log(`[cron] swarm daily scheduled: ${SWARM_DAILY_SCHEDULE} UTC`)
  } else {
    console.error(`[cron] invalid swarm daily schedule: ${SWARM_DAILY_SCHEDULE}`)
  }

  if (cron.validate(SWARM_MISSING_SCHEDULE)) {
    cron.schedule(SWARM_MISSING_SCHEDULE, () => {
      markMissingSwarmCollections().catch(e => console.error('[cron] swarm missing uncaught:', e))
    }, { timezone: 'UTC' })
    console.log(`[cron] swarm missing scheduled: ${SWARM_MISSING_SCHEDULE} UTC`)
  } else {
    console.error(`[cron] invalid swarm missing schedule: ${SWARM_MISSING_SCHEDULE}`)
  }
}

export async function runDailySwarmCollections(day = previousUtcDay()) {
  const created = await createDailyRuns({ day })
  console.log(`[cron] swarm daily ${day}: ${created.length} collection jobs ensured`)
  return created
}

export async function markMissingSwarmCollections(day = previousUtcDay()) {
  const missing = await markMissingDailyRuns({ day, reason: 'agent did not complete before deadline' })
  console.log(`[cron] swarm missing ${day}: ${missing.length} runs marked missing`)
  return missing
}

export { runDailyIdeas }

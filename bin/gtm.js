#!/usr/bin/env node
// gtm — unified CLI for the gtm-swarm platform.
//
// Single entry point that wraps every API capability so any agent (or
// Hunter's own Claude Code instance, or a teammate's terminal) can drive
// the swarm with one command.
//
// Auth: reads GTM_WRITES_TOKEN env (or ~/.gtm/token file). All read ops
// work without a token; write ops (log / actual / ideas / promote) need
// the bearer token.
//
// Base URL: GTM_API_URL env override; defaults to GTM production.
//
// Subcommands:
//   gtm log     --product X --agent Y [--value "..."] [--update "..."]
//                                     [--target "..."] [--note "..."]
//   gtm log read [--product X] [--agent Y] [--since-h N] [--limit N]
//   gtm idea pop|peek|list [--product X] [--agent Y]    (delegates locally)
//   gtm ideas --product X [--agent Y] [--n N]           (POST source-ideas)
//   gtm status [product]                                (north-star summary)
//   gtm record   --product X [--date D] [--traffic N] [--reg N] [--paid N]
//                            [--revenue N] [--note ...]
//   gtm ledger [product]                                (weekly counts)
//   gtm digest [--push]                                 (DingTalk preview/push)
//   gtm runtime doctor|plan|register|listen|update-scripts
//   gtm projects                                        (list projects)
//   gtm whoami                                          (config + auth state)

import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const API = process.env.GTM_API_URL || 'https://gtm.shulex.com'
const TOKEN_PATHS = [
  process.env.GTM_WRITES_TOKEN,
  (() => { try { return readFileSync(path.join(os.homedir(), '.gtm', 'token'), 'utf-8').trim() } catch { return null } })(),
  (() => { try { return readFileSync('/tmp/gtm-writes-token.txt', 'utf-8').trim() } catch { return null } })(),
]
const TOKEN = TOKEN_PATHS.find(t => t && t.length > 5) || null

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (t.startsWith('--')) {
      const k = t.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) { out[k] = next; i++ }
      else out[k] = true
    } else out._.push(t)
  }
  return out
}

async function get(path) {
  const r = await fetch(API + path)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error || `${r.status}`)
  return j
}

async function post(path, body) {
  if (!TOKEN) throw new Error('write op needs GTM_WRITES_TOKEN env or ~/.gtm/token file')
  const r = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `${r.status}`)
  return j
}

function usage() {
  console.log(`gtm — unified CLI for gtm-swarm  (API: ${API})

Builder daily standup:
  gtm log --product <slug> --agent <aid> [--value "..."] [--update "..."] [--target "..."] [--note "..."]
  gtm log read [--product X] [--agent Y] [--since-h N] [--limit N]

Idea pool:
  gtm idea peek|pop|list [--product X] [--agent Y] [--hook T] [--md]
  gtm ideas --product X [--agent Y] [--n N]            generate new ideas via LLM

Funnel + KPI:
  gtm status [product]                                  north-star snapshot
  gtm record --product X [--date D] [--traffic N] [--reg N] [--paid N] [--revenue N] [--note ...]

Ledger + digest:
  gtm ledger [product]                                  per-agent weekly counts
  gtm digest [--push]                                   DingTalk daily digest

Meta:
  gtm projects                                          list projects
  gtm whoami                                            config + auth state

Runtime fleet:
  gtm runtime doctor --machine <id>                  local path/env preflight
  gtm runtime plan --workspace <slug>                show machine registration plan
  gtm runtime register --machine <id> --workspace <slug> --profiles <a,b>
  gtm runtime listen --machine <id> --workspace <slug> --profiles <a,b>
  gtm runtime update-scripts                         git pull + npm install for this repo

Common opts:  --product/-p <slug>   --agent/-a <aid>
Env:          GTM_API_URL  GTM_WRITES_TOKEN  (or ~/.gtm/token file)
`)
}

const a = parseArgs(process.argv.slice(2))
const cmd = a._[0]
const sub = a._[1]
const product = a.product || a.p || a._[1]    // positional fallback for `gtm status voc-ai`
const agent = a.agent || a.a

async function runtimePost(path, body) {
  return post(path, body)
}

async function loadLocalRuntimeFleet() {
  const { loadRuntimeFleet, preflightMachine, buildRegistrationPlan, agentKeysForPack } = await import('../server/runtime-fleet.js')
  return { loadRuntimeFleet, preflightMachine, buildRegistrationPlan, agentKeysForPack }
}

function splitCsv(value) {
  return String(value || '').split(',').map(x => x.trim()).filter(Boolean)
}

function printPreflight(result) {
  console.log(`Machine: ${result.machineKey}`)
  console.log(`Present env: ${result.presentEnv.join(', ') || '(none)'}`)
  console.log(`Missing env: ${result.missingEnv.join(', ') || '(none)'}`)
  console.log(`Present paths: ${result.presentPaths.join(', ') || '(none)'}`)
  console.log(`Missing paths: ${result.missingPaths.join(', ') || '(none)'}`)
}

async function run() {
  switch (cmd) {
    case 'log': {
      if (sub === 'read') {
        const qs = new URLSearchParams()
        if (a.product || a.p) qs.set('project', a.product || a.p)
        if (a.agent || a.a) qs.set('agent', a.agent || a.a)
        if (a['since-h']) qs.set('since_hours', a['since-h'])
        if (a.limit) qs.set('limit', a.limit)
        const r = await get(`/api/builder-log?${qs}`)
        console.log(JSON.stringify(r, null, 2))
        return
      }
      // append entry
      const pr = a.product || a.p
      const ag = a.agent || a.a
      if (!pr || !ag) return console.error('Need --product and --agent') || process.exit(1)
      const body = {
        project: pr, agent: ag,
        builder: a.builder || null,
        value_point: a.value || a.v || a['value-point'],
        product_update: a.update || a.u || a['product-update'],
        target_update: a.target || a.t || a['target-update'],
        note: a.note,
        date: a.date,
      }
      const r = await post('/api/builder-log', body)
      console.log(JSON.stringify(r, null, 2))
      return
    }

    case 'idea': {
      // Delegate to local gtm-idea CLI (filesystem-based, doesn't need API)
      const { spawnSync } = await import('node:child_process')
      const args = process.argv.slice(3)
      const r = spawnSync('gtm-idea', args, { stdio: 'inherit' })
      process.exit(r.status || 0)
      return
    }

    case 'ideas': {
      const pr = a.product || a.p
      if (!pr) return console.error('Need --product') || process.exit(1)
      const body = { project: pr, agent: a.agent || a.a || undefined, n: parseInt(a.n || '5', 10) }
      const r = await post('/api/source-ideas', body)
      console.log(JSON.stringify(r, null, 2))
      return
    }

    case 'status': {
      const pr = product || 'voc-ai'
      const r = await get(`/api/north-star?project=${pr}`)
      console.log(`📊 ${pr}`)
      for (const [p, d] of Object.entries(r.periods)) {
        const lines = [`  ${p} (${d.from}):`]
        for (const s of ['traffic', 'registrations', 'payments', 'revenue_usd']) {
          const c = d[s]
          const pctStr = c.pct === null ? '—' : `${c.pct}%`
          lines.push(`    ${s.padEnd(15)} ${String(c.actual).padStart(8)} / ${c.target ?? '—'}  (${pctStr})`)
        }
        console.log(lines.join('\n'))
      }
      return
    }

    case 'record': {
      const pr = a.product || a.p
      if (!pr) return console.error('Need --product') || process.exit(1)
      const body = {
        project: pr,
        date: a.date,
        traffic: Number(a.traffic || 0) || 0,
        registrations: Number(a.reg || a.registrations || 0) || 0,
        payments: Number(a.paid || a.payments || 0) || 0,
        revenue_usd: Number(a.revenue || a.revenue_usd || 0) || 0,
        note: a.note || '',
      }
      const r = await post('/api/north-star/actual', body)
      console.log(JSON.stringify(r, null, 2))
      return
    }

    case 'ledger': {
      const pr = product || 'voc-ai'
      const r = await get(`/api/ledger?project=${pr}`)
      console.log(`📒 ${pr}  window: ${r.window_hours}h`)
      console.log(`Totals: ideas=${r.totals.freshIdeas}  drafts=${r.totals.freshDrafts}  bank=${r.totals.freshBank}  published=${r.totals.freshPublished}  pending=${r.totals.pendingReview}`)
      console.log()
      for (const x of r.agents) {
        const w = x.window
        const t = x.ironTriangleOK ? '🧱' + x.builder + '/👁' + x.reviewer : '⚠ incomplete'
        console.log(`  ${x.id.padEnd(18)} | ${(x.platform || '-').padEnd(28)} | i${w.new_ideas} d${w.drafts} b${w.bank} p${w.published} | ${t}`)
      }
      return
    }

    case 'digest': {
      const { spawnSync } = await import('node:child_process')
      const r = spawnSync('gtm-digest', a.push ? ['--push'] : [], { stdio: 'inherit' })
      process.exit(r.status || 0)
      return
    }

    case 'projects': {
      const r = await get('/api/health')
      console.log('Projects on ' + API + ':')
      for (const p of r.projects || []) console.log('  · ' + p)
      return
    }

    case 'whoami': {
      console.log('API:    ', API)
      console.log('Token:  ', TOKEN ? `${TOKEN.slice(0, 6)}…${TOKEN.slice(-4)}` : '(none — read-only)')
      const r = await get('/api/health').catch(e => ({ error: e.message }))
      console.log('Server: ', r.error ? `ERR ${r.error}` : `OK · anthropic=${r.anthropic} · projects=[${(r.projects || []).join(', ')}]`)
      return
    }

    case 'runtime': {
      const action = sub
      const machine = a.machine
      const workspace = a.workspace
      const profiles = splitCsv(a.profiles)
      const {
        loadRuntimeFleet,
        preflightMachine,
        buildRegistrationPlan,
        agentKeysForPack,
      } = await loadLocalRuntimeFleet()
      const fleet = loadRuntimeFleet()

      if (action === 'doctor') {
        if (!machine) return console.error('Need --machine') || process.exit(1)
        const result = preflightMachine(fleet, machine)
        printPreflight(result)
        process.exit(result.missingEnv.length || result.missingPaths.length ? 2 : 0)
      }

      if (action === 'plan') {
        if (!workspace) return console.error('Need --workspace') || process.exit(1)
        const agentKeys = agentKeysForPack(fleet, a.pack || 'gtm-core')
        const plan = buildRegistrationPlan(fleet, { workspace, agentKeys })
        console.log(JSON.stringify(plan, null, 2))
        return
      }

      if (action === 'register' || action === 'listen') {
        if (!machine || !workspace || !profiles.length) {
          return console.error('Need --machine, --workspace, and --profiles') || process.exit(1)
        }
        const preflight = preflightMachine(fleet, machine)
        const result = await runtimePost('/api/runtime/register', {
          machine,
          workspace,
          profiles,
          preflight,
        })
        console.log(JSON.stringify(result, null, 2))
        if (action === 'register') return

        console.log(`[runtime] registered. Listening loop is intentionally minimal in v1.`)
        console.log(`[runtime] Next implementation should poll Multica agent_task_queue for runtime ids: ${Object.values(result.runtimeIds || {}).join(', ')}`)
        return
      }

      if (action === 'update-scripts') {
        const { spawnSync } = await import('node:child_process')
        const repo = path.dirname(path.dirname(new URL(import.meta.url).pathname))
        const pull = spawnSync('git', ['pull', '--rebase'], { cwd: repo, stdio: 'inherit' })
        if (pull.status) process.exit(pull.status)
        const install = spawnSync('npm', ['install'], { cwd: repo, stdio: 'inherit' })
        process.exit(install.status || 0)
      }

      console.error(`unknown runtime command: ${action}`)
      usage()
      process.exit(1)
    }

    case 'help': case '-h': case '--help': case undefined:
      usage(); return

    default:
      console.error(`unknown command: ${cmd}`)
      usage()
      process.exit(1)
  }
}

run().catch(e => { console.error('ERR:', e.message); process.exit(1) })

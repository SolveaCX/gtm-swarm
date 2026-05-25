#!/usr/bin/env node
// scripts/sync-roster.js
//
// Regenerate ROSTER.md from server/agent-registry.js. Run after edits to the registry
// so the human-readable roster never drifts from the code-level source of truth.
//
// Usage:
//   node scripts/sync-roster.js          # writes ROSTER.md
//   node scripts/sync-roster.js --check  # exits 1 if ROSTER.md is stale (for CI)

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listAgentDefinitions } from '../server/agent-registry.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const ROSTER_PATH = path.join(REPO_ROOT, 'ROSTER.md')

const CATEGORY_BADGE = {
  'foundation':     '🟪',
  'content':        '🟩',
  'distribution':   '🟦',
  'revenue-leads':  '🟧',
}

function renderRoster() {
  const agents = listAgentDefinitions({ enabledOnly: false })
  const enabled = agents.filter(a => a.enabled)
  const lines = []

  lines.push('# GTM Agent Roster')
  lines.push('')
  lines.push('> **Auto-generated from `server/agent-registry.js`.** Do NOT hand-edit this file.')
  lines.push('> Regenerate via `node scripts/sync-roster.js`. CI guards drift via `--check`.')
  lines.push('')
  lines.push(`**Total: ${enabled.length} agents** · Categories: 🟪 Foundation · 🟩 Content · 🟦 Distribution · 🟧 Revenue·Leads`)
  lines.push('')
  lines.push('| # | Agent | Platforms | Reviewer | Builder | Goal Template | Reuse | Status |')
  lines.push('|---|---|---|---|---|---|---|---|')

  for (const a of enabled) {
    const badge = CATEGORY_BADGE[a.category] || ''
    const triangleOk = a.default_builder_handle != null && a.default_reviewer_handle != null
    const status = triangleOk ? '✅ deployable' : '🚫 blocked (no triangle)'
    const builder = a.default_builder_handle || '**TBD**'
    const reviewer = a.default_reviewer_handle || '**TBD**'
    const platforms = a.platforms.join(' · ')
    const reuse = a.reuse_pointer ? `\`${a.reuse_pointer}\`` : 'greenfield'
    const num = String(a.ordering).padStart(2, '0')
    lines.push(
      `| ${num} | ${badge} **${a.display_name}** | ${platforms} | ${reviewer} | ${builder} | ${a.goal_template} | ${reuse} | ${status} |`
    )
  }

  const deployable = enabled.filter(a => a.default_builder_handle && a.default_reviewer_handle)
  const blocked = enabled.filter(a => !(a.default_builder_handle && a.default_reviewer_handle))

  lines.push('')
  lines.push('## Deployment status')
  lines.push('')
  lines.push(`- ✅ Deployable (Iron Triangle complete): **${deployable.length}**`)
  lines.push(`- 🚫 TBD-blocked (missing Builder or Reviewer): **${blocked.length}**`)

  if (blocked.length) {
    lines.push('')
    lines.push('### TBD slots — forcing function for hiring')
    lines.push('')
    lines.push('Per Principle 3 (No Triangle = No Agent), blocked agents stay non-deployed until people are named:')
    lines.push('')
    for (const a of blocked) {
      const need = []
      if (!a.default_builder_handle) need.push('**Builder**')
      if (!a.default_reviewer_handle) need.push('**Reviewer**')
      lines.push(`- **${String(a.ordering).padStart(2, '0')} ${a.display_name}** needs ${need.join(' + ')}`)
    }
  }

  lines.push('')
  lines.push('## Adding a new agent')
  lines.push('')
  lines.push('1. Append entry to `server/agent-registry.js` (set `ordering` to next available number)')
  lines.push('2. Run `node scripts/sync-roster.js` to regenerate this file')
  lines.push('3. Commit both files together')
  lines.push('4. Step 4 ContentOS prompt picks up the new agent on next run — no prompt edit needed')

  return lines.join('\n') + '\n'
}

function main() {
  const check = process.argv.includes('--check')
  const expected = renderRoster()

  if (check) {
    const current = readFileSync(ROSTER_PATH, 'utf-8')
    if (current !== expected) {
      console.error('ROSTER.md is stale. Run: node scripts/sync-roster.js')
      process.exit(1)
    }
    console.log('ROSTER.md in sync with agent-registry.js ✓')
    return
  }

  writeFileSync(ROSTER_PATH, expected)
  console.log(`ROSTER.md regenerated (${expected.length} bytes)`)
}

main()

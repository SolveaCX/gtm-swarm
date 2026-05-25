import path from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import yaml from 'js-yaml'
import { complete } from './llm.js'
import { REPO_ROOT, PROJECTS_DIR, TEMPLATES_DIR } from './paths.js'
import { hasDB } from './db.js'
import * as store from './store.js'
import { agentRegistryForPrompt } from './agent-registry.js'

const STEPS = [
  { n: 1, slug: '01-market-insight', label: 'Market Insight', deps: [] },
  { n: 2, slug: '02-user-insight', label: 'User Insight', deps: ['01-market-insight'] },
  { n: 3, slug: '03-competitor-analysis', label: 'Competitor Analysis', deps: ['01-market-insight', '02-user-insight'] },
  { n: 4, slug: '04-content-strategy', label: 'Content Strategy', deps: ['01-market-insight', '02-user-insight', '03-competitor-analysis'] },
]

function loadState(projectDir) {
  const f = path.join(projectDir, '.contentos-state.json')
  if (!existsSync(f)) {
    return { current_step: 0, steps: Object.fromEntries(STEPS.map(s => [s.slug, { status: 'pending' }])) }
  }
  return JSON.parse(readFileSync(f, 'utf-8'))
}

function saveState(projectDir, state) {
  state.last_updated = new Date().toISOString()
  writeFileSync(path.join(projectDir, '.contentos-state.json'), JSON.stringify(state, null, 2))
}

function parseJsonish(value) {
  if (!value || typeof value !== 'string') return value || {}
  try { return JSON.parse(value) } catch { return {} }
}

export function ensureProjectScaffold({ slug, name, urls = {}, project_config = {} }) {
  if (!slug || !name) throw new Error('slug and name required')

  const projectDir = path.join(PROJECTS_DIR, slug)
  mkdirSync(path.join(projectDir, 'strategy'), { recursive: true })
  mkdirSync(path.join(projectDir, 'agents'), { recursive: true })

  const cfg = project_config || {}
  const website = urls.website || cfg.url || cfg.website || ''
  const projData = {
    slug,
    name,
    url: website,
    github_kb: urls.github_kb || cfg.github_kb || '',
    category: cfg.category || '',
    tagline: cfg.tagline || '',
    audience: cfg.audience,
    positioning: cfg.positioning,
    competitors: cfg.competitors,
    suggested_channels: cfg.suggested_channels,
    status: 'active',
  }
  const cleanProjData = Object.fromEntries(
    Object.entries(projData).filter(([, value]) => value !== undefined)
  )

  const projectYamlPath = path.join(projectDir, 'project.yaml')
  if (!existsSync(projectYamlPath)) {
    writeFileSync(projectYamlPath, yaml.dump(cleanProjData, { lineWidth: 0, sortKeys: false }))
  }

  const regPath = path.join(PROJECTS_DIR, '_registry.json')
  let reg = {}
  try { reg = JSON.parse(readFileSync(regPath, 'utf-8')) } catch {}
  if (!reg.projects) reg.projects = {}
  if (!reg.default) reg.default = slug
  reg.projects[slug] = { slug, name, url: website, status: 'active' }
  writeFileSync(regPath, JSON.stringify(reg, null, 2))

  return { slug, projectDir, projectYamlPath }
}

function formatCiaForPrompt(ciaResult) {
  if (!ciaResult) return null
  if (ciaResult.synthesis_md) return ciaResult.synthesis_md
  // Fallback: lightweight structured fields only
  const lines = []
  if (ciaResult.tagline) lines.push(`**定位：** ${ciaResult.tagline}`)
  if (ciaResult.category) lines.push(`**品类：** ${ciaResult.category}`)
  if (ciaResult.audience?.primary) {
    const sec = ciaResult.audience.secondary ? ` · ${ciaResult.audience.secondary}` : ''
    lines.push(`**核心受众：** ${ciaResult.audience.primary}${sec}`)
  }
  if (ciaResult.positioning) lines.push(`**差异化：** ${ciaResult.positioning}`)
  if (ciaResult.competitors?.length) lines.push(`**主要竞品：** ${ciaResult.competitors.join(' · ')}`)
  if (ciaResult.suggested_channels?.length) lines.push(`**建议渠道：** ${ciaResult.suggested_channels.join(' · ')}`)
  return lines.length ? lines.join('\n') : null
}

function readCiaData(projectDir) {
  // CIA integration: if `projects/<slug>/cia/synthesis.md` exists (produced
  // by running `cia init/fetch-*/export` locally), include it as primary
  // grounded-data source for Steps 1+2. Falls through silently if absent.
  const ciaDir = path.join(projectDir, 'cia')
  if (!existsSync(ciaDir)) return null
  const out = []
  const synth = path.join(ciaDir, 'synthesis.md')
  if (existsSync(synth)) {
    out.push(`### CIA synthesis.md (赛道矩阵 + TAM 估算)\n\n${readFileSync(synth, 'utf-8')}`)
  }
  // Also surface report.md if present (richer prose form)
  const report = path.join(ciaDir, 'report.md')
  if (existsSync(report) && !existsSync(synth)) {
    out.push(`### CIA report.md\n\n${readFileSync(report, 'utf-8')}`)
  }
  return out.length ? out.join('\n\n') : null
}

export function buildPrompt(stepIdx, projectDir, projectYaml, ciaResult = null) {
  const step = STEPS[stepIdx]
  const template = readFileSync(path.join(TEMPLATES_DIR, `${step.slug}.md`), 'utf-8')
  const parts = [`## ContentOS Agent — Running Step ${step.n}: ${step.label}\n`]
  parts.push('## PROJECT YAML\n')
  parts.push('```yaml\n' + yaml.dump(projectYaml, { sortKeys: false }) + '```\n')

  // CIA data injection — all 4 steps, DB source takes priority over filesystem
  const ciaText = formatCiaForPrompt(ciaResult) || readCiaData(projectDir)
  if (ciaText) {
    parts.push('## 🕵️ CIA 市场情报（真实数据 — Ahrefs/DataForSEO/TikTok/Reddit/iTunes）\n')
    parts.push('**核心原则：禁止编造数字。以下是 CIA pipeline 实测数据。**\n**Step 1-4 的 TAM/竞品格局/渠道判断必须从此数据引用，不得凭感觉估算。**\n\n')
    parts.push(ciaText)
    parts.push('\n')
  }

  for (const depSlug of step.deps) {
    const depFile = path.join(projectDir, 'strategy', `${depSlug}.md`)
    if (existsSync(depFile)) {
      // Strip non-BMP (4-byte UTF-8 emojis) — same issue that hits CIA data:
      // long prompts containing them trip Flatkey/CF upstream parsers.
      let depText = readFileSync(depFile, 'utf-8')
      depText = Array.from(depText).filter(c => c.codePointAt(0) < 0x10000).join('')
      parts.push(`## PRIOR OUTPUT — ${depSlug}.md\n`)
      parts.push(depText)
      parts.push('\n')
    } else {
      throw new Error(`Dependency missing: ${depFile}`)
    }
  }
  // Step 4 receives the agent registry — the universe of agents it may activate.
  // Source of truth: server/agent-registry.js. Eventual destination: agent_definitions DB table.
  // Honors Principle 04 (swarm adapts) by removing hardcoded 11-agent assumption from the prompt context.
  if (step.n === 4) {
    parts.push('## AGENT REGISTRY (the universe of agents you may activate)\n')
    parts.push('Below is the complete set of agent types currently registered on this platform. ')
    parts.push('You must emit an activation decision for EVERY agent in this list (true or false). ')
    parts.push('You may NOT invent agent slugs not present here.\n\n')
    parts.push('```json\n' + JSON.stringify(agentRegistryForPrompt(), null, 2) + '\n```\n')
  }

  parts.push('## INSTRUCTION TEMPLATE\n')
  parts.push(template)
  parts.push(`\n\nNow produce the output for Step ${step.n} (${step.label}). Output ONLY the markdown brief (and, for Step 4, the AGENT-HYDRATION block at the end). No preamble.`)
  return parts.join('\n')
}

export async function runContentOSStep(slug, n) {
  if (n < 1 || n > 4) throw new Error('step must be 1..4')
  const projectDir = path.join(PROJECTS_DIR, slug)
  const projectYamlPath = path.join(projectDir, 'project.yaml')
  if (!existsSync(projectYamlPath) && hasDB()) {
    const ws = await store.getWorkspace(slug)
    if (ws) {
      ensureProjectScaffold({
        slug,
        name: ws.name || slug,
        urls: parseJsonish(ws.urls),
        project_config: parseJsonish(ws.project_config),
      })
    }
  }
  if (!existsSync(projectDir)) throw new Error(`project not found: ${slug}`)
  if (!existsSync(projectYamlPath)) throw new Error(`project.yaml not found: ${slug}`)
  const projectYaml = yaml.load(readFileSync(projectYamlPath, 'utf-8')) || {}

  // Fetch cia_result from DB for prompt injection
  let ciaResult = null
  if (hasDB()) {
    try {
      const ws = await store.getWorkspace(slug)
      if (ws?.cia_result) {
        ciaResult = typeof ws.cia_result === 'string' ? JSON.parse(ws.cia_result) : ws.cia_result
      }
    } catch (e) {
      console.warn('[contentos] cia_result fetch failed (non-fatal):', e.message)
    }
  }

  const step = STEPS[n - 1]
  const state = loadState(projectDir)
  state.steps[step.slug] = { status: 'running', started_at: new Date().toISOString() }
  saveState(projectDir, state)

  const prompt = buildPrompt(n - 1, projectDir, projectYaml, ciaResult)
  const { text, usage } = await complete(prompt, { maxTokens: 20000 })

  const strategyDir = path.join(projectDir, 'strategy')
  mkdirSync(strategyDir, { recursive: true })
  const outFile = path.join(strategyDir, `${step.slug}.md`)
  writeFileSync(outFile, text)

  state.steps[step.slug] = {
    ...state.steps[step.slug],
    status: 'done',
    output_file: path.relative(REPO_ROOT, outFile),
    completed_at: new Date().toISOString(),
    size: text.length,
    usage,
  }
  state.current_step = n
  saveState(projectDir, state)

  // DB write (additive — filesystem already written above)
  if (hasDB()) {
    try {
      const ws = await store.getWorkspace(slug)
      if (ws) {
        await store.saveStrategyDoc(ws.id, step.slug, text, usage || null)
        const freshState = loadState(projectDir)
        await store.saveContentOSState(ws.id, {
          current_step: freshState.current_step,
          steps: freshState.steps,
        })
      }
    } catch (e) {
      console.warn('[contentos] DB write failed (non-fatal):', e.message)
    }
  }

  projectYaml.contentos_agent = projectYaml.contentos_agent || {}
  projectYaml.contentos_agent.state = n < 4 ? `step_${n}_done` : 'step_4_done'
  projectYaml.contentos_agent.last_run = new Date().toISOString()
  writeFileSync(projectYamlPath, yaml.dump(projectYaml, { lineWidth: 0, sortKeys: false }))

  return { step: n, file: path.relative(REPO_ROOT, outFile), size: text.length }
}

export function hydrateAgents(slug) {
  const projectDir = path.join(PROJECTS_DIR, slug)
  if (!existsSync(projectDir)) throw new Error(`project not found: ${slug}`)
  const strategyMd = path.join(projectDir, 'strategy', '04-content-strategy.md')
  if (!existsSync(strategyMd)) throw new Error('step 4 not done')
  const text = readFileSync(strategyMd, 'utf-8')
  const m = text.match(/---AGENT-HYDRATION-START---\s*\n([\s\S]*?)\n---AGENT-HYDRATION-END---/)
  if (!m) throw new Error('AGENT-HYDRATION block not found')
  let block = m[1].trim()
  block = block.replace(/^```ya?ml\s*\n/, '').replace(/\n```\s*$/, '')
  const parsed = yaml.load(block)
  if (!parsed?.agents) throw new Error('bad hydration block')
  const agentsDir = path.join(projectDir, 'agents')
  const updated = []; const skipped = []
  for (const [aid, fields] of Object.entries(parsed.agents)) {
    const yp = path.join(agentsDir, aid, 'agent.yaml')
    if (!existsSync(yp)) { skipped.push(aid); continue }
    const existing = yaml.load(readFileSync(yp, 'utf-8')) || {}
    const merged = { ...existing }
    for (const f of ['activate', 'goal', 'kpi', 'topics']) {
      if (f in fields) merged[f] = fields[f]
    }
    merged.contentos_hydrated_at = new Date().toISOString()
    if (fields.activate === false) merged.status = 'deactivated_by_contentos'
    else if (merged.status === 'deactivated_by_contentos') merged.status = 'active'
    writeFileSync(yp, yaml.dump(merged, { lineWidth: 0, sortKeys: false }))
    updated.push(aid)
  }
  const py = yaml.load(readFileSync(path.join(projectDir, 'project.yaml'), 'utf-8'))
  py.contentos_agent = { ...(py.contentos_agent || {}), state: 'built', built_at: new Date().toISOString(), agents_hydrated: updated.length }
  writeFileSync(path.join(projectDir, 'project.yaml'), yaml.dump(py, { lineWidth: 0, sortKeys: false }))
  return { updated, skipped }
}

export async function runMissingContentOSSteps(slug) {
  if (!hasDB()) return
  try {
    const ws = await store.getWorkspace(slug)
    if (!ws) return
    ensureProjectScaffold({
      slug,
      name: ws.name || slug,
      urls: parseJsonish(ws.urls),
      project_config: parseJsonish(ws.project_config),
    })
    for (const step of STEPS) {
      try {
        const existing = await store.getStrategyDoc(ws.id, step.slug)
        if (!existing) {
          await runContentOSStep(slug, step.n)
        }
      } catch (e) {
        console.warn(`[contentos] auto-gen step ${step.n} for ${slug} failed:`, e.message)
      }
    }
    console.log(`[contentos] runMissingContentOSSteps done for ${slug}`)
  } catch (e) {
    console.warn('[contentos] runMissingContentOSSteps outer error:', e.message)
  }
}

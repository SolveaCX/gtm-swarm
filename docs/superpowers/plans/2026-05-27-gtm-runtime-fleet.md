# GTM Runtime Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build GTM Runtime Fleet so each local machine can identify itself, preflight its capabilities, automatically register a Multica runtime listener for a workspace, and let new project workspaces receive ready or `needs_runtime` agents.

**Architecture:** Use file-backed fleet config first, with focused server modules for matching and Multica writes. Add CLI commands under `gtm runtime ...` for machine-side execution: `doctor`, `plan`, `register`, `listen`, and `update-scripts`. Project creation consumes the same fleet module to create setup issues instead of blocking when a runtime is offline.

**Tech Stack:** Node 22 ESM, `js-yaml`, Next.js route handlers, PostgreSQL via existing `pg` Multica helper, Node built-in test runner, existing `bin/gtm.js` CLI.

---

## File Structure

- Create: `config/runtime-machines.yaml` — known machines, capabilities, expected local paths, env names, listener command templates.
- Create: `config/runtime-profiles.yaml` — reusable runtime requirement classes for X, Reddit, SEO, research, strategist.
- Create: `config/agent-templates.yaml` — standard GTM agent pack, skills, model, visibility, and runtime profile per agent.
- Create: `server/runtime-fleet.js` — loads config, validates capabilities, checks local preflight data, selects machines, renders registration plans.
- Create: `server/runtime-fleet.test.js` — pure unit tests for matching, plan rendering, and status assignment.
- Modify: `server/multica-db.js` — add runtime registration helpers, setup issue helper, and agent upsert with `needs_runtime`.
- Modify: `server/multica-db.test.js` — SQL intent tests for runtime and setup issue writes.
- Create: `server/runtime-registration.js` — service that turns a local machine registration payload into Multica runtime records and agent bindings.
- Create: `server/runtime-registration.test.js` — mocked integration tests for registration.
- Create: `app/api/runtime/register/route.ts` — authenticated endpoint used by local machines to register a listener.
- Modify: `app/api/workspaces/route.ts` — after workspace creation, install agent pack and create runtime setup issue when needed.
- Modify: `bin/gtm.js` — add local commands `runtime doctor|plan|register|listen|update-scripts`.
- Create: `docs/RUNTIME_FLEET.md` — operator instructions for adding machines and running listeners.

## Task 1: File-Backed Fleet Config

**Files:**
- Create: `config/runtime-machines.yaml`
- Create: `config/runtime-profiles.yaml`
- Create: `config/agent-templates.yaml`

- [ ] **Step 1: Create machine registry**

Create `config/runtime-machines.yaml`:

```yaml
machines:
  boyuan-mac-mini:
    owner: boyuan
    role: local-automation
    labels:
      - trusted-local
      - macos
    capabilities:
      - shell
      - browser_cdp
      - launchd
      - x_automation
      - reddit_automation
      - seo_publish
      - image_generation
      - review_analysis
    paths:
      x_agent: /Users/siliconno3/x_agent
      reddit_agent: /Users/boyuangao/gtm/reddit-agent
      gtm_repo: /Users/boyuangao/skills/gtm-swarm
      gtm_skills: /Users/boyuangao/gtm
    env_required:
      - GTM_WRITES_TOKEN
    listener:
      command_template: "gtm runtime listen --machine boyuan-mac-mini --workspace {{workspace}} --profiles {{profiles}}"
```

- [ ] **Step 2: Create runtime profile registry**

Create `config/runtime-profiles.yaml`:

```yaml
profiles:
  local-x-runtime:
    capabilities:
      - shell
      - browser_cdp
      - x_automation
    required_paths:
      - x_agent
    env_required:
      - GTM_WRITES_TOKEN
      - ANTHROPIC_API_KEY
      - TELEGRAM_BOT_TOKEN
      - TELEGRAM_CHAT_ID
    preferred_machines:
      - boyuan-mac-mini

  local-reddit-runtime:
    capabilities:
      - shell
      - browser_cdp
      - reddit_automation
      - launchd
    required_paths:
      - reddit_agent
    env_required:
      - GTM_WRITES_TOKEN
      - ANTHROPIC_API_KEY
    preferred_machines:
      - boyuan-mac-mini

  gtm-seo-runtime:
    capabilities:
      - shell
      - seo_publish
      - image_generation
    required_paths:
      - gtm_skills
    env_required:
      - GTM_WRITES_TOKEN
      - SOLVEA_API_KEY
      - QUERIT_API_KEY
      - GIT_AUTH_TOKEN
    preferred_machines:
      - boyuan-mac-mini

  gtm-research-runtime:
    capabilities:
      - shell
      - review_analysis
    required_paths:
      - gtm_skills
    env_required:
      - GTM_WRITES_TOKEN
      - VOC_API_KEY
    preferred_machines:
      - boyuan-mac-mini

  gtm-strategist-runtime:
    capabilities:
      - shell
    required_paths:
      - gtm_repo
    env_required:
      - GTM_WRITES_TOKEN
    preferred_machines:
      - boyuan-mac-mini
```

- [ ] **Step 3: Create initial agent template pack**

Create `config/agent-templates.yaml`:

```yaml
agent_packs:
  gtm-core:
    agents:
      - gtm-strategist
      - seo-blog-agent
      - x-growth-agent
      - reddit-growth-agent
      - voc-research-agent

agents:
  gtm-strategist:
    name: GTM Strategist
    description: Runs Agent-First GTM planning and turns project context into channel strategy.
    visibility: workspace
    model: gpt-5.5
    runtime_profile: gtm-strategist-runtime
    skills:
      - agent-gtm
    status_without_runtime: needs_runtime

  seo-blog-agent:
    name: SEO Blog Agent
    description: Produces, publishes, and optimizes SEO articles with banners and citation audits.
    visibility: workspace
    model: gpt-5.5
    runtime_profile: gtm-seo-runtime
    skills:
      - solvea-blog-daily-batch
      - solvea-article-pipeline
      - voc-blog-daily-batch
      - voc-article-pipeline
      - optimize-blog-data-facts
      - topic-map
    status_without_runtime: needs_runtime

  x-growth-agent:
    name: X Growth Agent
    description: Operates X engage, quote scout, Telegram approval, and analytics feedback loops.
    visibility: workspace
    model: gpt-5.5
    runtime_profile: local-x-runtime
    skills:
      - hunter-x-agent
      - voc-ai-x-agent
    status_without_runtime: needs_runtime

  reddit-growth-agent:
    name: Reddit Growth Agent
    description: Operates Reddit account warmup, karma, comment generation, scheduling, and health checks.
    visibility: workspace
    model: gpt-5.5
    runtime_profile: local-reddit-runtime
    skills:
      - reddit-growth-operator
    status_without_runtime: needs_runtime

  voc-research-agent:
    name: VOC Research Agent
    description: Runs review analysis and topic research to feed channel agents.
    visibility: workspace
    model: gpt-5.5
    runtime_profile: gtm-research-runtime
    skills:
      - review-analyzer
      - topic-map
    status_without_runtime: needs_runtime
```

- [ ] **Step 4: Commit config**

Run:

```bash
git add config/runtime-machines.yaml config/runtime-profiles.yaml config/agent-templates.yaml
git commit -m "feat: add runtime fleet config"
```

Expected: commit succeeds with three new YAML files.

## Task 2: Runtime Fleet Resolver

**Files:**
- Create: `server/runtime-fleet.test.js`
- Create: `server/runtime-fleet.js`

- [ ] **Step 1: Write failing tests**

Create `server/runtime-fleet.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  loadRuntimeFleet,
  selectMachineForProfile,
  renderRegistrationCommand,
  buildRegistrationPlan,
  preflightMachine,
} from './runtime-fleet.js'

const fleet = {
  machines: {
    'mac-a': {
      capabilities: ['shell', 'browser_cdp', 'x_automation'],
      paths: { x_agent: '/tmp/x_agent' },
      env_required: ['GTM_WRITES_TOKEN'],
      listener: {
        command_template: 'gtm runtime listen --machine mac-a --workspace {{workspace}} --profiles {{profiles}}',
      },
    },
    'mac-b': {
      capabilities: ['shell'],
      paths: { gtm_repo: '/tmp/gtm' },
      listener: {
        command_template: 'gtm runtime listen --machine mac-b --workspace {{workspace}} --profiles {{profiles}}',
      },
    },
  },
  profiles: {
    'local-x-runtime': {
      capabilities: ['shell', 'browser_cdp', 'x_automation'],
      required_paths: ['x_agent'],
      env_required: ['ANTHROPIC_API_KEY'],
      preferred_machines: ['mac-a'],
    },
  },
  agents: {
    'x-growth-agent': {
      name: 'X Growth Agent',
      runtime_profile: 'local-x-runtime',
      status_without_runtime: 'needs_runtime',
    },
  },
}

test('selectMachineForProfile picks preferred capable machine', () => {
  const selected = selectMachineForProfile(fleet, 'local-x-runtime')
  assert.equal(selected.machineKey, 'mac-a')
  assert.deepEqual(selected.missingCapabilities, [])
})

test('selectMachineForProfile rejects machines missing capabilities', () => {
  const selected = selectMachineForProfile({
    ...fleet,
    profiles: {
      bad: {
        capabilities: ['reddit_automation'],
        required_paths: [],
        env_required: [],
        preferred_machines: ['mac-b'],
      },
    },
  }, 'bad')

  assert.equal(selected.machineKey, null)
  assert.deepEqual(selected.missingCapabilities, ['reddit_automation'])
})

test('renderRegistrationCommand replaces workspace and profiles', () => {
  const command = renderRegistrationCommand(fleet.machines['mac-a'], {
    workspace: 'voc-ai',
    profiles: ['local-x-runtime'],
  })
  assert.equal(command, 'gtm runtime listen --machine mac-a --workspace voc-ai --profiles local-x-runtime')
})

test('buildRegistrationPlan groups agents by machine and profile', () => {
  const plan = buildRegistrationPlan(fleet, {
    workspace: 'voc-ai',
    agentKeys: ['x-growth-agent'],
  })

  assert.equal(plan.workspace, 'voc-ai')
  assert.equal(plan.items.length, 1)
  assert.equal(plan.items[0].machineKey, 'mac-a')
  assert.deepEqual(plan.items[0].profiles, ['local-x-runtime'])
  assert.deepEqual(plan.items[0].agents, ['X Growth Agent'])
})

test('preflightMachine reports missing env and paths without exposing values', () => {
  const result = preflightMachine(fleet, 'mac-a', {
    env: { GTM_WRITES_TOKEN: 'secret' },
    exists: filePath => filePath === '/tmp/x_agent',
  })

  assert.deepEqual(result.presentEnv, ['GTM_WRITES_TOKEN'])
  assert.deepEqual(result.missingEnv, [])
  assert.deepEqual(result.presentPaths, ['x_agent'])
  assert.deepEqual(result.missingPaths, [])
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('loadRuntimeFleet reads committed config files', () => {
  const loaded = loadRuntimeFleet()
  assert.ok(loaded.machines['boyuan-mac-mini'])
  assert.ok(loaded.profiles['local-x-runtime'])
  assert.ok(loaded.agents['x-growth-agent'])
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test server/runtime-fleet.test.js
```

Expected: FAIL with module not found for `server/runtime-fleet.js`.

- [ ] **Step 3: Implement resolver**

Create `server/runtime-fleet.js`:

```js
import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

function readYaml(relativePath) {
  return yaml.load(readFileSync(path.join(ROOT, relativePath), 'utf-8')) || {}
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))]
}

export function loadRuntimeFleet() {
  const machines = readYaml('config/runtime-machines.yaml').machines || {}
  const profiles = readYaml('config/runtime-profiles.yaml').profiles || {}
  const templateConfig = readYaml('config/agent-templates.yaml')
  return {
    machines,
    profiles,
    agentPacks: templateConfig.agent_packs || {},
    agents: templateConfig.agents || {},
  }
}

export function selectMachineForProfile(fleet, profileKey) {
  const profile = fleet.profiles[profileKey]
  if (!profile) throw new Error(`runtime profile not found: ${profileKey}`)

  const required = profile.capabilities || []
  const orderedKeys = uniq([
    ...(profile.preferred_machines || []),
    ...Object.keys(fleet.machines || {}),
  ])

  let aggregateMissing = []
  for (const machineKey of orderedKeys) {
    const machine = fleet.machines[machineKey]
    if (!machine) continue
    const caps = new Set(machine.capabilities || [])
    const missing = required.filter(cap => !caps.has(cap))
    if (!missing.length) {
      return { machineKey, machine, missingCapabilities: [] }
    }
    aggregateMissing.push(...missing)
  }

  return {
    machineKey: null,
    machine: null,
    missingCapabilities: uniq(aggregateMissing.length ? aggregateMissing : required),
  }
}

export function renderRegistrationCommand(machine, { workspace, profiles }) {
  const template = machine.listener?.command_template
  if (!template) throw new Error('machine listener.command_template is required')
  return template
    .replaceAll('{{workspace}}', workspace)
    .replaceAll('{{profiles}}', profiles.join(','))
}

export function buildRegistrationPlan(fleet, { workspace, agentKeys }) {
  const groups = new Map()
  const missing = []

  for (const agentKey of agentKeys) {
    const agent = fleet.agents[agentKey]
    if (!agent) throw new Error(`agent template not found: ${agentKey}`)
    const profileKey = agent.runtime_profile
    const selected = selectMachineForProfile(fleet, profileKey)
    if (!selected.machineKey) {
      missing.push({
        agentKey,
        agentName: agent.name,
        profile: profileKey,
        missingCapabilities: selected.missingCapabilities,
      })
      continue
    }
    if (!groups.has(selected.machineKey)) {
      groups.set(selected.machineKey, {
        machineKey: selected.machineKey,
        machine: selected.machine,
        profiles: [],
        agents: [],
      })
    }
    const group = groups.get(selected.machineKey)
    group.profiles = uniq([...group.profiles, profileKey])
    group.agents.push(agent.name)
  }

  const items = [...groups.values()].map(group => ({
    machineKey: group.machineKey,
    profiles: group.profiles,
    agents: group.agents,
    command: renderRegistrationCommand(group.machine, { workspace, profiles: group.profiles }),
  }))

  return { workspace, items, missing }
}

export function preflightMachine(fleet, machineKey, { env = process.env, exists = existsSync } = {}) {
  const machine = fleet.machines[machineKey]
  if (!machine) throw new Error(`machine not found: ${machineKey}`)

  const envRequired = machine.env_required || []
  const pathEntries = Object.entries(machine.paths || {})

  return {
    machineKey,
    presentEnv: envRequired.filter(key => Boolean(env[key])),
    missingEnv: envRequired.filter(key => !env[key]),
    presentPaths: pathEntries.filter(([, filePath]) => exists(filePath)).map(([key]) => key),
    missingPaths: pathEntries.filter(([, filePath]) => !exists(filePath)).map(([key]) => key),
  }
}

export function agentKeysForPack(fleet, packKey = 'gtm-core') {
  const pack = fleet.agentPacks[packKey]
  if (!pack) throw new Error(`agent pack not found: ${packKey}`)
  return pack.agents || []
}
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
node --test server/runtime-fleet.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit resolver**

Run:

```bash
git add server/runtime-fleet.js server/runtime-fleet.test.js
git commit -m "feat: resolve runtime fleet plans"
```

Expected: commit succeeds.

## Task 3: Multica Runtime Registration Helpers

**Files:**
- Modify: `server/multica-db.test.js`
- Modify: `server/multica-db.js`

- [ ] **Step 1: Add failing tests**

Append to `server/multica-db.test.js`:

```js
test('registerRuntimeListener upserts runtime by workspace machine and profile', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    if (sql.includes('INSERT INTO runtime')) return { rows: [{ id: 'runtime-1' }] }
    return { rows: [] }
  }

  try {
    const { registerRuntimeListener } = await import(`./multica-db.js?listener=${Date.now()}`)
    const runtimeId = await registerRuntimeListener('workspace-1', {
      machineKey: 'boyuan-mac-mini',
      profile: 'local-x-runtime',
      capabilities: ['shell', 'x_automation'],
      status: 'online',
      health: { missingEnv: [] },
    })

    assert.equal(runtimeId, 'runtime-1')
    const write = queries.find(q => q.sql.includes('INSERT INTO runtime'))
    assert.ok(write)
    assert.ok(write.params.includes('boyuan-mac-mini'))
    assert.ok(write.params.includes('local-x-runtime'))
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})

test('createRuntimeSetupIssue creates issue assigned to no agent with setup label', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    if (sql.includes('INSERT INTO issue_label') && _params.includes('runtime-setup')) return { rows: [{ id: 'label-runtime' }] }
    if (sql.includes('INSERT INTO issue')) return { rows: [{ id: 'issue-1' }] }
    return { rows: [] }
  }

  try {
    const { createRuntimeSetupIssue } = await import(`./multica-db.js?setup=${Date.now()}`)
    const issueId = await createRuntimeSetupIssue('workspace-1', {
      creatorId: 'bot-1',
      title: 'Runtime registration needed',
      description: 'Run gtm runtime listen',
    })

    assert.equal(issueId, 'issue-1')
    assert.ok(queries.some(q => q.sql.includes('INSERT INTO issue_label') && q.params[1] === 'runtime-setup'))
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})

test('bindAgentsToRuntimeProfile attaches waiting agents to runtime id', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    return { rows: [{ id: 'agent-1' }] }
  }

  try {
    const { bindAgentsToRuntimeProfile } = await import(`./multica-db.js?bind=${Date.now()}`)
    const rows = await bindAgentsToRuntimeProfile('workspace-1', {
      profile: 'local-x-runtime',
      runtimeId: 'runtime-1',
    })

    assert.equal(rows.length, 1)
    const update = queries.find(q => q.sql.includes('UPDATE agent'))
    assert.ok(update)
    assert.ok(update.sql.includes("runtime_config->>'runtime_profile' = $2"))
    assert.deepEqual(update.params, ['workspace-1', 'local-x-runtime', 'runtime-1'])
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test server/multica-db.test.js
```

Expected: FAIL because `registerRuntimeListener`, `createRuntimeSetupIssue`, and `bindAgentsToRuntimeProfile` are not exported.

- [ ] **Step 3: Implement helpers**

Add to `server/multica-db.js` after `upsertRuntimeBackedAgent`:

```js
export async function registerRuntimeListener(workspaceId, {
  machineKey,
  profile,
  capabilities = [],
  status = 'online',
  health = {},
}) {
  if (!workspaceId) throw new Error('workspaceId is required')
  if (!machineKey) throw new Error('machineKey is required')
  if (!profile) throw new Error('profile is required')

  const row = await q1(
    `INSERT INTO runtime
       (workspace_id, name, machine_key, profile, capabilities, status, health, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (workspace_id, machine_key, profile)
     DO UPDATE SET
       capabilities = EXCLUDED.capabilities,
       status = EXCLUDED.status,
       health = EXCLUDED.health,
       last_seen_at = now()
     RETURNING id`,
    [
      workspaceId,
      `${machineKey}:${profile}`,
      machineKey,
      profile,
      JSON.stringify(capabilities),
      status,
      JSON.stringify(health),
    ]
  )
  return row.id
}

export async function createRuntimeSetupIssue(workspaceId, {
  creatorId,
  title,
  description,
}) {
  const issueId = await createIssue(workspaceId, {
    title,
    description,
    status: 'backlog',
    priority: 'high',
    creatorId,
  })
  const labelId = await getOrCreateLabel(workspaceId, 'runtime-setup', '#f97316')
  await addIssueLabel(issueId, labelId)
  return issueId
}

export async function bindAgentsToRuntimeProfile(workspaceId, {
  profile,
  runtimeId,
}) {
  if (!workspaceId) throw new Error('workspaceId is required')
  if (!profile) throw new Error('profile is required')
  if (!runtimeId) throw new Error('runtimeId is required')

  return q(
    `UPDATE agent
     SET runtime_id = $3, status = 'idle'
     WHERE workspace_id = $1
       AND runtime_config->>'runtime_profile' = $2
       AND (runtime_id IS NULL OR status = 'needs_runtime')
     RETURNING id`,
    [workspaceId, profile, runtimeId]
  )
}
```

- [ ] **Step 4: Add defensive migration note**

Add a new migration file `migrations/004-runtime-fleet.sql`:

```sql
CREATE TABLE IF NOT EXISTS runtime (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspace(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  machine_key TEXT NOT NULL,
  profile TEXT NOT NULL,
  capabilities JSONB DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'offline',
  health JSONB DEFAULT '{}',
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (workspace_id, machine_key, profile)
);

ALTER TABLE agent ADD COLUMN IF NOT EXISTS runtime_id UUID REFERENCES runtime(id);
ALTER TABLE agent ADD COLUMN IF NOT EXISTS runtime_mode TEXT DEFAULT 'cloud';
ALTER TABLE agent ADD COLUMN IF NOT EXISTS runtime_config JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_runtime_workspace_profile ON runtime(workspace_id, profile);
CREATE INDEX IF NOT EXISTS idx_runtime_last_seen ON runtime(last_seen_at);
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test server/multica-db.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Multica helpers**

Run:

```bash
git add server/multica-db.js server/multica-db.test.js migrations/004-runtime-fleet.sql
git commit -m "feat: register multica runtime listeners"
```

Expected: commit succeeds.

## Task 4: Runtime Registration Service and API

**Files:**
- Create: `server/runtime-registration.test.js`
- Create: `server/runtime-registration.js`
- Create: `app/api/runtime/register/route.ts`

- [ ] **Step 1: Write service tests**

Create `server/runtime-registration.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { registerMachineRuntime } from './runtime-registration.js'

test('registerMachineRuntime registers each requested profile and returns runtime ids', async () => {
  const calls = []
  const result = await registerMachineRuntime({
    workspace: { id: 'workspace-1', slug: 'voc-ai' },
    machineKey: 'boyuan-mac-mini',
    profiles: ['local-x-runtime'],
    preflight: { missingEnv: [], missingPaths: [] },
    deps: {
      registerRuntimeListener: async (workspaceId, payload) => {
        calls.push({ workspaceId, payload })
        return 'runtime-1'
      },
      bindAgentsToRuntimeProfile: async (workspaceId, payload) => {
        calls.push({ workspaceId, payload, kind: 'bind' })
        return [{ id: 'agent-1' }]
      },
    },
  })

  assert.deepEqual(result.runtimeIds, { 'local-x-runtime': 'runtime-1' })
  assert.equal(calls[0].workspaceId, 'workspace-1')
  assert.equal(calls[0].payload.machineKey, 'boyuan-mac-mini')
  assert.equal(calls[0].payload.profile, 'local-x-runtime')
  assert.equal(calls[0].payload.status, 'online')
  assert.equal(calls[1].kind, 'bind')
  assert.deepEqual(calls[1].payload, { profile: 'local-x-runtime', runtimeId: 'runtime-1' })
})

test('registerMachineRuntime marks status needs_env when preflight misses env', async () => {
  const calls = []
  await registerMachineRuntime({
    workspace: { id: 'workspace-1', slug: 'voc-ai' },
    machineKey: 'boyuan-mac-mini',
    profiles: ['local-x-runtime'],
    preflight: { missingEnv: ['ANTHROPIC_API_KEY'], missingPaths: [] },
    deps: {
      registerRuntimeListener: async (workspaceId, payload) => {
        calls.push({ workspaceId, payload })
        return 'runtime-1'
      },
    },
  })

  assert.equal(calls[0].payload.status, 'needs_env')
  assert.deepEqual(calls[0].payload.health.missingEnv, ['ANTHROPIC_API_KEY'])
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test server/runtime-registration.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement service**

Create `server/runtime-registration.js`:

```js
import { loadRuntimeFleet } from './runtime-fleet.js'
import { bindAgentsToRuntimeProfile, registerRuntimeListener } from './multica-db.js'

function statusFromPreflight(preflight) {
  if ((preflight.missingEnv || []).length) return 'needs_env'
  if ((preflight.missingPaths || []).length) return 'blocked_config'
  return 'online'
}

export async function registerMachineRuntime({
  workspace,
  machineKey,
  profiles,
  preflight,
  deps = { registerRuntimeListener, bindAgentsToRuntimeProfile },
}) {
  if (!workspace?.id) throw new Error('workspace.id is required')
  if (!machineKey) throw new Error('machineKey is required')
  if (!Array.isArray(profiles) || !profiles.length) throw new Error('profiles are required')

  const fleet = loadRuntimeFleet()
  const machine = fleet.machines[machineKey]
  if (!machine) throw new Error(`machine not found: ${machineKey}`)

  const status = statusFromPreflight(preflight || {})
  const runtimeIds = {}

  for (const profile of profiles) {
    if (!fleet.profiles[profile]) throw new Error(`runtime profile not found: ${profile}`)
    runtimeIds[profile] = await deps.registerRuntimeListener(workspace.id, {
      machineKey,
      profile,
      capabilities: machine.capabilities || [],
      status,
      health: preflight || {},
    })
    if (status === 'online') {
      await deps.bindAgentsToRuntimeProfile(workspace.id, {
        profile,
        runtimeId: runtimeIds[profile],
      })
    }
  }

  return { workspace: workspace.slug, machineKey, runtimeIds, status }
}
```

- [ ] **Step 4: Create API route**

Create `app/api/runtime/register/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { hasMultica, getWorkspaceBySlug } from '@/server/multica-db.js'
import { registerMachineRuntime } from '@/server/runtime-registration.js'

function bearer(request: NextRequest) {
  const header = request.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

export async function POST(request: NextRequest) {
  try {
    if (!hasMultica()) {
      return NextResponse.json({ error: 'multica not configured' }, { status: 503 })
    }
    const token = bearer(request)
    if (!token || token !== process.env.GTM_WRITES_TOKEN) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const workspace = await getWorkspaceBySlug(body.workspace)
    if (!workspace) {
      return NextResponse.json({ error: `workspace not found: ${body.workspace}` }, { status: 404 })
    }

    const result = await registerMachineRuntime({
      workspace,
      machineKey: body.machine,
      profiles: body.profiles,
      preflight: body.preflight,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
node --test server/runtime-registration.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit service and API**

Run:

```bash
git add server/runtime-registration.js server/runtime-registration.test.js app/api/runtime/register/route.ts
git commit -m "feat: add runtime registration API"
```

Expected: commit succeeds.

## Task 5: Local Machine CLI Commands

**Files:**
- Modify: `bin/gtm.js`

- [ ] **Step 1: Add runtime usage text**

In `bin/gtm.js`, extend `usage()` with:

```text
Runtime fleet:
  gtm runtime doctor --machine <id>                  local path/env preflight
  gtm runtime plan --workspace <slug>                show machine registration plan
  gtm runtime register --machine <id> --workspace <slug> --profiles <a,b>
  gtm runtime listen --machine <id> --workspace <slug> --profiles <a,b>
  gtm runtime update-scripts                         git pull + npm install for this repo
```

- [ ] **Step 2: Add local runtime helpers**

In `bin/gtm.js`, add these helpers above `async function run()`:

```js
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
```

- [ ] **Step 3: Add runtime command branch**

In `bin/gtm.js`, add a `case 'runtime'` branch before `case 'help'`:

```js
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
```

- [ ] **Step 4: Run local CLI checks**

Run:

```bash
node bin/gtm.js runtime plan --workspace voc-ai
node bin/gtm.js runtime doctor --machine boyuan-mac-mini
```

Expected:

- `runtime plan` prints JSON with one or more registration commands.
- `runtime doctor` prints missing/present env and paths. Exit code may be `2` if local env is missing; that is acceptable.

- [ ] **Step 5: Commit CLI**

Run:

```bash
git add bin/gtm.js
git commit -m "feat: add runtime fleet cli"
```

Expected: commit succeeds.

## Task 6: Install Agent Pack During Project Creation

**Files:**
- Create: `server/agent-pack-installer.test.js`
- Create: `server/agent-pack-installer.js`
- Modify: `app/api/workspaces/route.ts`

- [ ] **Step 1: Write installer tests**

Create `server/agent-pack-installer.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentInstallPlan } from './agent-pack-installer.js'

test('buildAgentInstallPlan marks agents needs_runtime when no runtime ids exist', () => {
  const fleet = {
    agentPacks: { 'gtm-core': { agents: ['x-growth-agent'] } },
    agents: {
      'x-growth-agent': {
        name: 'X Growth Agent',
        description: 'X',
        model: 'gpt-5.5',
        visibility: 'workspace',
        runtime_profile: 'local-x-runtime',
        status_without_runtime: 'needs_runtime',
      },
    },
  }

  const plan = buildAgentInstallPlan(fleet, {
    pack: 'gtm-core',
    runtimeIdsByProfile: {},
  })

  assert.equal(plan.agents.length, 1)
  assert.equal(plan.agents[0].name, 'X Growth Agent')
  assert.equal(plan.agents[0].status, 'needs_runtime')
  assert.equal(plan.agents[0].runtimeId, null)
})

test('buildAgentInstallPlan binds runtime id when profile is available', () => {
  const fleet = {
    agentPacks: { 'gtm-core': { agents: ['x-growth-agent'] } },
    agents: {
      'x-growth-agent': {
        name: 'X Growth Agent',
        description: 'X',
        model: 'gpt-5.5',
        visibility: 'workspace',
        runtime_profile: 'local-x-runtime',
        status_without_runtime: 'needs_runtime',
      },
    },
  }

  const plan = buildAgentInstallPlan(fleet, {
    pack: 'gtm-core',
    runtimeIdsByProfile: { 'local-x-runtime': 'runtime-1' },
  })

  assert.equal(plan.agents[0].status, 'idle')
  assert.equal(plan.agents[0].runtimeId, 'runtime-1')
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
node --test server/agent-pack-installer.test.js
```

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement installer plan builder**

Create `server/agent-pack-installer.js`:

```js
import { agentKeysForPack, buildRegistrationPlan, loadRuntimeFleet } from './runtime-fleet.js'
import { createRuntimeSetupIssue, getOrCreateGTMUser, upsertRuntimeBackedAgent } from './multica-db.js'

export function buildAgentInstallPlan(fleet, {
  pack = 'gtm-core',
  runtimeIdsByProfile = {},
}) {
  const agentKeys = agentKeysForPack(fleet, pack)
  const agents = agentKeys.map(agentKey => {
    const template = fleet.agents[agentKey]
    const runtimeId = runtimeIdsByProfile[template.runtime_profile] || null
    return {
      agentKey,
      name: template.name,
      description: template.description,
      model: template.model,
      visibility: template.visibility || 'workspace',
      runtimeProfile: template.runtime_profile,
      runtimeId,
      status: runtimeId ? 'idle' : (template.status_without_runtime || 'needs_runtime'),
      runtimeConfig: {
        agent_key: agentKey,
        runtime_profile: template.runtime_profile,
        model: template.model,
        visibility: template.visibility || 'workspace',
        skills: template.skills || [],
        description: template.description,
      },
    }
  })
  return { pack, agents }
}

function renderSetupIssue(plan) {
  const blocks = plan.items.map(item => [
    `### Machine: ${item.machineKey}`,
    '',
    `Profiles: ${item.profiles.join(', ')}`,
    '',
    '```bash',
    item.command,
    '```',
    '',
    'Agents waiting:',
    ...item.agents.map(name => `- ${name}`),
  ].join('\n'))

  const missing = plan.missing.length
    ? ['## Missing Capabilities', '', ...plan.missing.map(row => `- ${row.agentName}: ${row.missingCapabilities.join(', ')}`)].join('\n')
    : ''

  return ['## Runtime Registration Needed', '', `Workspace: ${plan.workspace}`, '', ...blocks, missing].filter(Boolean).join('\n\n')
}

export async function installAgentPackForWorkspace(workspace, {
  pack = 'gtm-core',
  runtimeIdsByProfile = {},
} = {}) {
  const fleet = loadRuntimeFleet()
  const installPlan = buildAgentInstallPlan(fleet, { pack, runtimeIdsByProfile })

  for (const agent of installPlan.agents) {
    await upsertRuntimeBackedAgent(workspace.id, {
      name: agent.name,
      runtimeId: agent.runtimeId,
      runtimeMode: 'cloud',
      runtimeConfig: agent.runtimeConfig,
      status: agent.status,
    })
  }

  const waitingAgentKeys = installPlan.agents
    .filter(agent => !agent.runtimeId)
    .map(agent => agent.agentKey)

  if (waitingAgentKeys.length) {
    const botId = await getOrCreateGTMUser(workspace.id)
    const registrationPlan = buildRegistrationPlan(fleet, {
      workspace: workspace.slug,
      agentKeys: waitingAgentKeys,
    })
    await createRuntimeSetupIssue(workspace.id, {
      creatorId: botId,
      title: `Runtime registration needed for ${workspace.slug}`,
      description: renderSetupIssue(registrationPlan),
    })
  }

  return installPlan
}
```

- [ ] **Step 4: Allow `needs_runtime` agents without a runtime id**

Change `upsertRuntimeBackedAgent` in `server/multica-db.js` so `runtimeId: null` is valid and `runtimeId: undefined` is the only invalid value:

```js
if (runtimeId === undefined) throw new Error('runtimeId is required')
```

Update both SQL parameter arrays inside that function so they pass `runtimeId || null`:

```js
[workspaceId, name, runtimeId || null, runtimeMode, JSON.stringify(runtimeConfig), status]
```

- [ ] **Step 5: Wire project creation**

In `app/api/workspaces/route.ts`, replace the Multica creation block:

```ts
      if (hasMultica()) {
        const { getOrCreateWorkspace } = await import('@/server/multica-db.js')
        await getOrCreateWorkspace(slug, name)
        ws = await store.bindMulticaWorkspace(slug, slug)
      }
```

with:

```ts
      if (hasMultica()) {
        const { getOrCreateWorkspace, getWorkspaceBySlug } = await import('@/server/multica-db.js')
        const { installAgentPackForWorkspace } = await import('@/server/agent-pack-installer.js')
        await getOrCreateWorkspace(slug, name)
        ws = await store.bindMulticaWorkspace(slug, slug)
        const multicaWorkspace = await getWorkspaceBySlug(slug)
        if (multicaWorkspace) {
          await installAgentPackForWorkspace(multicaWorkspace, { pack: 'gtm-core' })
        }
      }
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test server/agent-pack-installer.test.js server/runtime-fleet.test.js server/multica-db.test.js
```

Expected: PASS. If a test fails because the current Multica schema requires non-null `runtime_id`, update migration and helper together so `needs_runtime` agents can exist without a runtime.

- [ ] **Step 7: Commit installer**

Run:

```bash
git add server/agent-pack-installer.js server/agent-pack-installer.test.js app/api/workspaces/route.ts server/multica-db.js server/multica-db.test.js
git commit -m "feat: install runtime aware agent pack"
```

Expected: commit succeeds.

## Task 7: Operator Docs and Script Update Workflow

**Files:**
- Create: `docs/RUNTIME_FLEET.md`

- [ ] **Step 1: Create operator guide**

Create `docs/RUNTIME_FLEET.md`:

````md
# Runtime Fleet

GTM Swarm owns the runtime fleet registry. Multica owns the actual runtime listener records.

## Add A Machine

1. Add the machine to `config/runtime-machines.yaml`.
2. Declare capabilities honestly. Do not list `x_automation` unless the machine has the X stack and credentials.
3. Add expected local paths under `paths`.
4. Add env variable names only. Never commit secret values.
5. Commit the registry update.

## Check A Machine

Run this on the target machine:

```bash
gtm runtime update-scripts
gtm runtime doctor --machine boyuan-mac-mini
```

`doctor` exits `0` when all declared machine-level env and paths exist. It exits `2` when config is incomplete.

## Register A Machine To A Workspace

Run:

```bash
gtm runtime plan --workspace voc-ai
gtm runtime register --machine boyuan-mac-mini --workspace voc-ai --profiles local-x-runtime,local-reddit-runtime
```

`register` calls GTM Swarm, which writes runtime listener rows into Multica and returns runtime IDs.

## Start Listening

Run:

```bash
gtm runtime listen --machine boyuan-mac-mini --workspace voc-ai --profiles local-x-runtime,local-reddit-runtime
```

Version 1 registers the channel and prints the runtime IDs. The next iteration should poll Multica's task queue and execute work for those runtime IDs.

## Update Scripts Later

On each machine:

```bash
gtm runtime update-scripts
```

This runs `git pull --rebase` and `npm install` in the GTM Swarm repo. If the repo has local changes, the command fails and the operator must resolve them.
````

- [ ] **Step 2: Commit docs**

Run:

```bash
git add docs/RUNTIME_FLEET.md
git commit -m "docs: explain runtime fleet operations"
```

Expected: commit succeeds.

## Task 8: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test server/runtime-fleet.test.js server/runtime-registration.test.js server/agent-pack-installer.test.js server/multica-db.test.js
```

Expected: PASS.

- [ ] **Step 2: Run CLI smoke checks**

Run:

```bash
node bin/gtm.js runtime plan --workspace voc-ai
node bin/gtm.js runtime doctor --machine boyuan-mac-mini || test $? -eq 2
```

Expected:

- Plan prints JSON registration commands.
- Doctor either passes or exits `2` for missing local env/path.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: Next.js build completes.

- [ ] **Step 4: Inspect git state**

Run:

```bash
git status --short
```

Expected: only user-owned pre-existing files may remain modified. Runtime Fleet implementation files should be committed.

## Execution Notes

This plan deliberately makes `gtm runtime listen` auto-register the Multica channel before doing any task polling. That gives the operator one command to run on a machine:

```bash
gtm runtime listen --machine boyuan-mac-mini --workspace <workspace> --profiles <profiles>
```

The listener identifies the machine by the `--machine` key. It proves what it can do by loading `config/runtime-machines.yaml`, running local path/env preflight, and registering only the requested profiles that exist in `config/runtime-profiles.yaml`.

Script updates are also a first-class operator command:

```bash
gtm runtime update-scripts
```

That keeps the machine on the latest GTM fleet registry and CLI without requiring the operator to remember the repo path.

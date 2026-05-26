# GTM Swarm Multica Operating Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working system loop for GTM proposal creation, Multica issue tracking, runtime-backed agent binding, and AI strategy review.

**Architecture:** Keep Multica as the operational control plane and GTM Swarm as the knowledge and metrics layer. Add a small server-side proposal domain module, extend `server/multica-db.js` with runtime-backed agent and proposal issue helpers, then expose one API for AI review digest generation and proposal creation.

**Tech Stack:** Next.js route handlers, Node server modules, PostgreSQL via `pg`, Node built-in test runner, existing `complete()` LLM helper.

---

## File Structure

- Create: `server/gtm-proposals.js` — proposal schema normalization, validation, markdown rendering, issue-title generation.
- Create: `server/gtm-proposals.test.js` — unit tests for proposal validation and rendering.
- Modify: `server/multica-db.js` — add runtime-backed agent upsert and proposal issue creation helpers.
- Modify: `server/multica-db.test.js` — tests for runtime-backed agent and proposal issue SQL.
- Create: `server/strategy-reviewer.js` — builds AI strategy review prompts, parses proposal JSON, and creates Multica proposal issues.
- Create: `server/strategy-reviewer.test.js` — tests prompt shaping and parser behavior without network calls.
- Create: `app/api/strategy-review/route.ts` — authenticated project endpoint to generate strategy review proposals.
- Modify: `docs/GTM_SWARM_OPERATING_MODEL.md` — add implementation status section after the first phase lands.

## Phase 1 Scope

This plan intentionally does not implement a full review inbox UI. The first phase creates Multica issues that can be reviewed in Multica immediately.

Phase 1 delivers:

- Standard proposal data structure.
- Runtime-backed Multica agent helper.
- Proposal-to-Multica-issue creation.
- AI strategy reviewer that generates proposal candidates.
- API endpoint to trigger the review for a project.
- Tests covering validation, SQL intent, and parser behavior.

## Task 1: Proposal Domain Module

**Files:**
- Create: `server/gtm-proposals.js`
- Create: `server/gtm-proposals.test.js`

- [ ] **Step 1: Write failing tests for proposal validation**

Create `server/gtm-proposals.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProposal,
  renderProposalMarkdown,
  proposalIssueTitle,
} from './gtm-proposals.js'

test('normalizes a valid SOP change proposal', () => {
  const proposal = normalizeProposal({
    type: 'sop_change',
    project: 'voc-ai',
    target_scope: 'project',
    target_agent_type: 'reddit',
    target_file: 'projects/voc-ai/sop/reddit.md',
    title: 'Prefer pain-first hooks',
    summary: 'Pain-first hooks produced stronger comment depth.',
    evidence: [{ kind: 'metric', reference: 'comment depth +42%' }],
    risk: 'medium',
    confidence: 'medium',
    requires_human_approval: true,
    expected_effect: 'Improve Reddit reply rate.',
    rollback_plan: 'Remove override if next 5 posts underperform.',
  })

  assert.equal(proposal.type, 'sop_change')
  assert.equal(proposal.requires_human_approval, true)
  assert.equal(proposal.evidence.length, 1)
})

test('rejects unknown proposal type', () => {
  assert.throws(
    () => normalizeProposal({ type: 'random', project: 'voc-ai', title: 'Bad' }),
    /invalid proposal type/
  )
})

test('renders proposal markdown with evidence and rollback plan', () => {
  const proposal = normalizeProposal({
    type: 'memory_update',
    project: 'voc-ai',
    target_scope: 'project',
    target_agent_type: 'research',
    target_file: 'projects/voc-ai/memory/audience.md',
    title: 'Add speed objection',
    summary: 'Users worry review analysis takes too long.',
    evidence: [{ kind: 'artifact', reference: 'multica://issue/abc' }],
    risk: 'low',
    confidence: 'high',
    requires_human_approval: true,
    expected_effect: 'Improve objection handling.',
    rollback_plan: 'Remove memory entry.',
  })

  const md = renderProposalMarkdown(proposal)
  assert.match(md, /## GTM Proposal/)
  assert.match(md, /type: memory_update/)
  assert.match(md, /multica:\/\/issue\/abc/)
  assert.match(md, /Remove memory entry/)
})

test('builds stable issue titles', () => {
  const proposal = normalizeProposal({
    type: 'experiment_task',
    project: 'voc-ai',
    title: 'Test pain-first hooks',
    summary: 'Compare variants.',
  })
  assert.equal(proposalIssueTitle(proposal), '[experiment_task] Test pain-first hooks')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test server/gtm-proposals.test.js
```

Expected: FAIL because `server/gtm-proposals.js` does not exist.

- [ ] **Step 3: Implement proposal module**

Create `server/gtm-proposals.js`:

```js
const TYPES = new Set(['execution_task', 'experiment_task', 'memory_update', 'sop_change'])
const SCOPES = new Set(['project', 'global'])
const LEVELS = new Set(['low', 'medium', 'high'])

function requiredString(value, field) {
  const s = String(value || '').trim()
  if (!s) throw new Error(`${field} is required`)
  return s
}

function normalizeEvidence(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map(row => ({
      kind: String(row?.kind || 'note').trim() || 'note',
      reference: String(row?.reference || '').trim(),
    }))
    .filter(row => row.reference)
}

export function normalizeProposal(input = {}) {
  const type = requiredString(input.type, 'type')
  if (!TYPES.has(type)) throw new Error(`invalid proposal type: ${type}`)

  const project = requiredString(input.project, 'project')
  const title = requiredString(input.title, 'title')
  const targetScope = String(input.target_scope || 'project').trim()
  if (!SCOPES.has(targetScope)) throw new Error(`invalid target_scope: ${targetScope}`)

  const risk = String(input.risk || 'medium').trim()
  if (!LEVELS.has(risk)) throw new Error(`invalid risk: ${risk}`)

  const confidence = String(input.confidence || 'medium').trim()
  if (!LEVELS.has(confidence)) throw new Error(`invalid confidence: ${confidence}`)

  return {
    type,
    project,
    target_scope: targetScope,
    target_agent_type: String(input.target_agent_type || '').trim(),
    target_file: String(input.target_file || '').trim(),
    title,
    summary: String(input.summary || '').trim(),
    evidence: normalizeEvidence(input.evidence),
    risk,
    confidence,
    requires_human_approval: input.requires_human_approval !== false,
    expected_effect: String(input.expected_effect || '').trim(),
    rollback_plan: String(input.rollback_plan || '').trim(),
  }
}

export function proposalIssueTitle(proposal) {
  return `[${proposal.type}] ${proposal.title}`.slice(0, 180)
}

export function renderProposalMarkdown(proposal) {
  const evidence = proposal.evidence.length
    ? proposal.evidence.map(e => `- ${e.kind}: ${e.reference}`).join('\n')
    : '- note: No evidence supplied'

  return [
    '## GTM Proposal',
    '',
    '```yaml',
    `type: ${proposal.type}`,
    `project: ${proposal.project}`,
    `target_scope: ${proposal.target_scope}`,
    `target_agent_type: ${proposal.target_agent_type}`,
    `target_file: ${proposal.target_file}`,
    `risk: ${proposal.risk}`,
    `confidence: ${proposal.confidence}`,
    `requires_human_approval: ${proposal.requires_human_approval}`,
    '```',
    '',
    `### Summary`,
    proposal.summary || proposal.title,
    '',
    `### Evidence`,
    evidence,
    '',
    `### Expected Effect`,
    proposal.expected_effect || 'Not specified',
    '',
    `### Rollback Plan`,
    proposal.rollback_plan || 'Reject or close this proposal before it lands.',
  ].join('\n')
}
```

- [ ] **Step 4: Run proposal tests**

Run:

```bash
node --test server/gtm-proposals.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/gtm-proposals.js server/gtm-proposals.test.js
git commit -m "feat: add gtm proposal schema"
```

## Task 2: Runtime-Backed Multica Agent Helpers

**Files:**
- Modify: `server/multica-db.js`
- Modify: `server/multica-db.test.js`

- [ ] **Step 1: Add failing tests**

Append to `server/multica-db.test.js`:

```js
test('upsertRuntimeBackedAgent creates agent with runtime_id and config', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    if (sql.includes('SELECT id FROM agent')) return { rows: [] }
    if (sql.includes('INSERT INTO agent')) return { rows: [{ id: 'agent-1' }] }
    return { rows: [] }
  }

  try {
    const { upsertRuntimeBackedAgent } = await import(`./multica-db.js?runtime=${Date.now()}`)
    const id = await upsertRuntimeBackedAgent('workspace-1', {
      name: 'GTM-Reddit',
      runtimeId: 'runtime-1',
      runtimeConfig: { gtm_channel: 'reddit' },
    })

    assert.equal(id, 'agent-1')
    assert.ok(queries.some(q => q.sql.includes('runtime_id') && q.params.includes('runtime-1')))
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test server/multica-db.test.js
```

Expected: FAIL because `upsertRuntimeBackedAgent` is not exported.

- [ ] **Step 3: Implement runtime-backed helper**

Add to `server/multica-db.js` after `upsertChannelAgent`:

```js
export async function upsertRuntimeBackedAgent(workspaceId, {
  name,
  runtimeId,
  runtimeMode = 'cloud',
  runtimeConfig = {},
  status = 'idle',
}) {
  if (!workspaceId) throw new Error('workspaceId is required')
  if (!name) throw new Error('agent name is required')
  if (!runtimeId) throw new Error('runtimeId is required')

  const existing = await q1(
    'SELECT id FROM agent WHERE workspace_id = $1 AND name = $2',
    [workspaceId, name]
  )
  if (existing) {
    const row = await q1(
      `UPDATE agent
       SET runtime_id = $3, runtime_mode = $4, runtime_config = $5, status = $6
       WHERE workspace_id = $1 AND name = $2
       RETURNING id`,
      [workspaceId, name, runtimeId, runtimeMode, JSON.stringify(runtimeConfig), status]
    )
    return row.id
  }

  const row = await q1(
    `INSERT INTO agent (workspace_id, name, runtime_id, runtime_mode, runtime_config, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [workspaceId, name, runtimeId, runtimeMode, JSON.stringify(runtimeConfig), status]
  )
  return row.id
}
```

- [ ] **Step 4: Run Multica tests**

Run:

```bash
node --test server/multica-db.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/multica-db.js server/multica-db.test.js
git commit -m "feat: add runtime backed multica agent upsert"
```

## Task 3: Proposal Issue Creation Helper

**Files:**
- Modify: `server/multica-db.js`
- Modify: `server/multica-db.test.js`

- [ ] **Step 1: Add failing test for proposal issue creation**

Append to `server/multica-db.test.js`:

```js
test('createProposalIssue creates a typed Multica issue with labels', async () => {
  const queries = []
  const originalQuery = pg.Pool.prototype.query
  process.env.MULTICA_DATABASE_URL = 'postgres://user:pass@localhost:5432/multica_test'

  pg.Pool.prototype.query = async (_sql, _params = []) => {
    const sql = String(_sql)
    queries.push({ sql, params: _params })
    if (sql.includes('INSERT INTO issue_label')) return { rows: [{ id: 'label-1' }] }
    if (sql.includes('INSERT INTO issue_to_label')) return { rows: [] }
    if (sql.includes('INSERT INTO issue')) return { rows: [{ id: 'issue-1' }] }
    return { rows: [] }
  }

  try {
    const { createProposalIssue } = await import(`./multica-db.js?proposal=${Date.now()}`)
    const issueId = await createProposalIssue('workspace-1', {
      title: '[sop_change] Prefer pain-first hooks',
      description: '## GTM Proposal',
      creatorId: 'bot-1',
      proposalType: 'sop_change',
      priority: 'medium',
    })

    assert.equal(issueId, 'issue-1')
    assert.ok(queries.some(q => q.sql.includes('INSERT INTO issue') && q.params.includes('[sop_change] Prefer pain-first hooks')))
    assert.ok(queries.some(q => q.sql.includes('issue_to_label')))
  } finally {
    pg.Pool.prototype.query = originalQuery
    delete process.env.MULTICA_DATABASE_URL
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test server/multica-db.test.js
```

Expected: FAIL because `createProposalIssue` is not exported.

- [ ] **Step 3: Implement helper**

Add to `server/multica-db.js` after `createIssue`:

```js
const PROPOSAL_COLORS = {
  execution_task: '#10b981',
  experiment_task: '#6366f1',
  memory_update: '#f59e0b',
  sop_change: '#ef4444',
}

export async function createProposalIssue(workspaceId, {
  title,
  description,
  creatorId,
  proposalType,
  priority = 'medium',
}) {
  const issueId = await createIssue(workspaceId, {
    title,
    description,
    status: 'backlog',
    priority,
    creatorId,
  })
  const baseLabel = await getOrCreateLabel(workspaceId, 'gtm-proposal', '#0ea5e9')
  await addIssueLabel(issueId, baseLabel)

  const typeLabel = await getOrCreateLabel(
    workspaceId,
    `gtm-${proposalType}`,
    PROPOSAL_COLORS[proposalType] || '#64748b'
  )
  await addIssueLabel(issueId, typeLabel)
  return issueId
}
```

- [ ] **Step 4: Run Multica tests**

Run:

```bash
node --test server/multica-db.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/multica-db.js server/multica-db.test.js
git commit -m "feat: create multica proposal issues"
```

## Task 4: AI Strategy Reviewer Service

**Files:**
- Create: `server/strategy-reviewer.js`
- Create: `server/strategy-reviewer.test.js`

- [ ] **Step 1: Write parser and prompt tests**

Create `server/strategy-reviewer.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStrategyReviewPrompt,
  parseStrategyReviewResponse,
} from './strategy-reviewer.js'

test('buildStrategyReviewPrompt includes project, metrics, and issue context', () => {
  const prompt = buildStrategyReviewPrompt({
    project: 'voc-ai',
    metricsSummary: 'Traffic up 12%, registrations flat.',
    issueSummary: 'Reddit draft rejected twice for product-heavy language.',
    artifactSummary: 'Top post used pain-first hook.',
  })

  assert.match(prompt, /voc-ai/)
  assert.match(prompt, /Traffic up 12%/)
  assert.match(prompt, /Reddit draft rejected twice/)
  assert.match(prompt, /Return ONLY valid JSON/)
})

test('parseStrategyReviewResponse normalizes proposals from JSON', () => {
  const proposals = parseStrategyReviewResponse(JSON.stringify({
    proposals: [{
      type: 'memory_update',
      project: 'voc-ai',
      title: 'Add speed objection',
      summary: 'Users worry analysis is slow.',
      evidence: [{ kind: 'note', reference: 'review comments' }],
    }],
  }))

  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].type, 'memory_update')
  assert.equal(proposals[0].requires_human_approval, true)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --test server/strategy-reviewer.test.js
```

Expected: FAIL because `server/strategy-reviewer.js` does not exist.

- [ ] **Step 3: Implement strategy reviewer service**

Create `server/strategy-reviewer.js`:

```js
import { complete } from './llm.js'
import { normalizeProposal, proposalIssueTitle, renderProposalMarkdown } from './gtm-proposals.js'
import {
  getWorkspaceBySlug,
  getOrCreateGTMUser,
  createProposalIssue,
} from './multica-db.js'

export function buildStrategyReviewPrompt({
  project,
  metricsSummary = '',
  issueSummary = '',
  artifactSummary = '',
}) {
  return `You are the AI Strategy Reviewer for GTM Swarm project: ${project}.

Your job is to identify operational learnings and propose next actions.

METRICS SUMMARY:
${metricsSummary || 'No metrics supplied.'}

MULTICA ISSUE SUMMARY:
${issueSummary || 'No issue summary supplied.'}

ARTIFACT SUMMARY:
${artifactSummary || 'No artifact summary supplied.'}

Return ONLY valid JSON. No markdown fences.
{
  "proposals": [
    {
      "type": "execution_task" | "experiment_task" | "memory_update" | "sop_change",
      "project": "${project}",
      "target_scope": "project" | "global",
      "target_agent_type": "",
      "target_file": "",
      "title": "",
      "summary": "",
      "evidence": [{ "kind": "metric" | "artifact" | "reviewer_note" | "note", "reference": "" }],
      "risk": "low" | "medium" | "high",
      "confidence": "low" | "medium" | "high",
      "requires_human_approval": true,
      "expected_effect": "",
      "rollback_plan": ""
    }
  ]
}`
}

export function parseStrategyReviewResponse(text) {
  const clean = String(text || '').replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()
  const parsed = JSON.parse(clean)
  const rows = Array.isArray(parsed?.proposals) ? parsed.proposals : []
  return rows.map(normalizeProposal)
}

export async function generateStrategyReviewProposals({
  project,
  metricsSummary = '',
  issueSummary = '',
  artifactSummary = '',
}) {
  const prompt = buildStrategyReviewPrompt({ project, metricsSummary, issueSummary, artifactSummary })
  const { text } = await complete(prompt, { maxTokens: 4000 })
  return parseStrategyReviewResponse(text)
}

export async function createStrategyReviewIssues({
  project,
  proposals,
}) {
  const workspace = await getWorkspaceBySlug(project)
  if (!workspace) throw new Error(`multica workspace not found: ${project}`)

  const botId = await getOrCreateGTMUser(workspace.id)
  const created = []
  for (const proposal of proposals.map(normalizeProposal)) {
    const issueId = await createProposalIssue(workspace.id, {
      title: proposalIssueTitle(proposal),
      description: renderProposalMarkdown(proposal),
      creatorId: botId,
      proposalType: proposal.type,
      priority: proposal.risk === 'high' ? 'high' : 'medium',
    })
    created.push({ issue_id: issueId, proposal })
  }
  return created
}
```

- [ ] **Step 4: Run strategy reviewer tests**

Run:

```bash
node --test server/strategy-reviewer.test.js server/gtm-proposals.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/strategy-reviewer.js server/strategy-reviewer.test.js
git commit -m "feat: add ai strategy reviewer proposals"
```

## Task 5: Strategy Review API Route

**Files:**
- Create: `app/api/strategy-review/route.ts`

- [ ] **Step 1: Implement route**

Create `app/api/strategy-review/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { hasMultica } from '@/server/multica-db.js'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const project = String(body.project || '').trim()
    if (!project) {
      return NextResponse.json({ error: 'project required' }, { status: 400 })
    }
    if (!hasMultica()) {
      return NextResponse.json({ error: 'multica not configured' }, { status: 503 })
    }
    if (!hasDB()) {
      return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
    }

    const ws = await store.getWorkspace(project)
    if (!ws?.multica_workspace_slug) {
      return NextResponse.json({ error: 'no multica workspace bound to this project' }, { status: 400 })
    }

    const {
      generateStrategyReviewProposals,
      createStrategyReviewIssues,
    } = await import('@/server/strategy-reviewer.js')

    const proposals = await generateStrategyReviewProposals({
      project: ws.multica_workspace_slug,
      metricsSummary: String(body.metrics_summary || ''),
      issueSummary: String(body.issue_summary || ''),
      artifactSummary: String(body.artifact_summary || ''),
    })
    const created = await createStrategyReviewIssues({
      project: ws.multica_workspace_slug,
      proposals,
    })

    return NextResponse.json({
      ok: true,
      project,
      multica_workspace_slug: ws.multica_workspace_slug,
      proposal_count: proposals.length,
      issues: created.map(row => ({
        issue_id: row.issue_id,
        type: row.proposal.type,
        title: row.proposal.title,
      })),
    })
  } catch (e: unknown) {
    console.error('[strategy-review]', e)
    return NextResponse.json({ error: String((e as Error)?.message || e) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test server/gtm-proposals.test.js server/strategy-reviewer.test.js server/multica-db.test.js
```

Expected: PASS.

- [ ] **Step 3: Build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/strategy-review/route.ts
git commit -m "feat: expose strategy review proposal api"
```

## Task 6: Documentation Status Update

**Files:**
- Modify: `docs/GTM_SWARM_OPERATING_MODEL.md`

- [ ] **Step 1: Add implementation status section**

Append to `docs/GTM_SWARM_OPERATING_MODEL.md`:

```md
---

## 12. 当前系统落地状态

第一期系统落地范围：

- Proposal schema 已标准化。
- Multica proposal issue 可由 GTM Swarm 创建。
- Runtime-backed Multica agent helper 已加入服务层。
- AI Strategy Reviewer 可生成 proposals 并写入 Multica。
- Dashboard 专用 review inbox 仍在下一期。

当前推荐操作方式：

1. 在 dashboard 或脚本中触发 strategy review。
2. 到 Multica 查看 `gtm-proposal` issues。
3. Human reviewer 审批、编辑或关闭 proposal。
4. 被批准的 SOP / memory 变更再进入 patch 流程。
```

- [ ] **Step 2: Verify docs and tests**

Run:

```bash
rg -n "deferred implementation marker|unknown placeholder" docs/GTM_SWARM_OPERATING_MODEL.md docs/superpowers/specs/2026-05-26-gtm-swarm-multica-operating-model-design.md
node --test server/gtm-proposals.test.js server/strategy-reviewer.test.js server/multica-db.test.js
```

Expected: `rg` exits with no matches and `node --test` passes.

- [ ] **Step 3: Commit**

```bash
git add docs/GTM_SWARM_OPERATING_MODEL.md
git commit -m "docs: record operating model implementation status"
```

## Phase 2 Follow-Up

After Phase 1 works, implement:

- Dashboard proposal inbox filtered by `gtm-proposal` labels.
- Approve/reject/edit actions for proposal issues.
- SOP maintainer agent that turns approved `sop_change` issues into patches.
- Project memory writer for approved `memory_update` issues.
- Daily cron that calls the strategy review API per active project.

## Self-Review

- Spec coverage: This plan maps the operating model into proposal schema, Multica issue creation, runtime-backed agent helper, AI reviewer generation, and API entrypoint. It intentionally leaves dashboard inbox and patch application for Phase 2.
- Placeholder scan: The plan avoids deferred implementation markers and unspecified implementation placeholders.
- Type consistency: Proposal field names match the operating model document and are reused across module, service, and API route.

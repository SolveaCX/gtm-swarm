# Daily Telemetry Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GTM Swarm actively dispatch daily telemetry collection tasks to Multica agents with clear task payloads, visible dispatch outcomes, and reusable agent skill instructions.

**Architecture:** Reuse the existing cron, `swarm_daily_runs`, `swarm_jobs`, and Multica dispatch path. Add small pure helpers for task description generation and dispatch result formatting so behavior is testable without a live Multica database. Keep channel-specific metric collection in each agent `SKILL.md`.

**Tech Stack:** Node.js ESM, Next.js API routes, PostgreSQL-backed store functions, `node:test`, existing GTM Swarm telemetry contract.

---

## File Structure

- Modify `server/swarm-daily.js`: add pure helpers for daily task descriptions and dispatch status fragments.
- Modify `server/swarm-daily.test.js`: test task payload text, required fields, and dispatch status formatting.
- Modify `server/swarm-store.js`: use the new helper in `dispatchDailyRunToMultica()` and record specific dispatch outcomes for unavailable Multica, missing workspace, missing runtime, success, and thrown errors.
- Modify `gtm-swarm-cli/specs/agent-json-contract.md`: document `collect_daily_telemetry` task expectations.
- Modify `templates/contentos-agent/04-content-strategy.md`: include a reusable daily telemetry section for generated agents.
- Modify existing project agent `SKILL.md` files under `projects/flatkey/agents/*/SKILL.md`: add the shared daily telemetry section to current agents.

## Task 1: Pure Daily Dispatch Helpers

**Files:**
- Modify: `server/swarm-daily.js`
- Test: `server/swarm-daily.test.js`

- [ ] **Step 1: Write failing tests**

Add tests to `server/swarm-daily.test.js`:

```js
import {
  buildDailyCollectionJobTarget,
  buildDailyDispatchDescription,
  buildDailyDispatchStatusFragment,
  buildDailyTargetFromBatch,
  dayWindow,
  previousUtcDay,
} from './swarm-daily.js'

test('builds an actionable daily dispatch description for Multica agents', () => {
  const description = buildDailyDispatchDescription({
    target: {
      workspace_slug: 'flatkey',
      agent_key: 'x-growth-agent',
      platform: 'x',
      report_type: 'generic',
    },
    day: '2026-05-26',
    runId: 'run-123',
    jobId: 'job-456',
    publicUrl: 'https://gtm.example.com',
  })

  assert.match(description, /GTM Swarm Daily Telemetry Collection/)
  assert.match(description, /Workspace: flatkey/)
  assert.match(description, /Agent key: x-growth-agent/)
  assert.match(description, /From: 2026-05-26T00:00:00.000Z/)
  assert.match(description, /To: 2026-05-26T23:59:59.999Z/)
  assert.match(description, /Swarm job id: job-456/)
  assert.match(description, /Daily run id: run-123/)
  assert.match(description, /POST https:\/\/gtm.example.com\/api\/swarm\/jobs\/job-456\/complete/)
  assert.match(description, /schema_version.*swarm.telemetry.v1/s)
  assert.match(description, /If collection cannot be completed/)
})

test('formats daily dispatch status fragments', () => {
  assert.equal(
    buildDailyDispatchStatusFragment({ status: 'dispatched', issueId: 'issue-1', taskId: 'task-2' }),
    'dispatch=dispatched; multica_issue=issue-1; multica_task=task-2; '
  )
  assert.equal(
    buildDailyDispatchStatusFragment({ status: 'no_runtime', reason: 'agent runtime missing' }),
    'dispatch=no_runtime; reason=agent runtime missing; '
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/swarm-daily.test.js`

Expected: FAIL because `buildDailyDispatchDescription` and `buildDailyDispatchStatusFragment` are not exported.

- [ ] **Step 3: Implement helpers**

In `server/swarm-daily.js`, export:

```js
export function buildDailyDispatchDescription({ target, day, runId, jobId, publicUrl = '' }) {
  const window = dayWindow(day)
  const completeUrl = publicUrl
    ? `${publicUrl.replace(/\/$/, '')}/api/swarm/jobs/${jobId}/complete`
    : `/api/swarm/jobs/${jobId}/complete`
  const requiredMetrics = buildDailyCollectionJobTarget({ day, target, runId }).required_metrics
  return [
    '## GTM Swarm Daily Telemetry Collection',
    '',
    `Workspace: ${target.workspace_slug}`,
    `Agent key: ${target.agent_key}`,
    `Platform: ${target.platform}`,
    `Report type: ${target.report_type}`,
    `Day: ${day}`,
    `From: ${window.from}`,
    `To: ${window.to}`,
    `Swarm job id: ${jobId}`,
    `Daily run id: ${runId}`,
    '',
    'Task:',
    'Collect the daily telemetry summary for this agent, platform, and UTC day.',
    'Use the agent-specific Daily Telemetry Collection section in your SKILL.md for channel-specific collection steps.',
    '',
    'Return format:',
    '- Complete the Swarm job with a JSON payload.',
    '- Successful completion should include a `batch` using `schema_version: "swarm.telemetry.v1"`.',
    '- Observations must use numeric metric values and ISO 8601 timestamps.',
    requiredMetrics.length ? `- Required metrics: ${requiredMetrics.join(', ')}` : '- Required metrics: use the metrics defined by this agent and platform.',
    '',
    `Completion endpoint: POST ${completeUrl}`,
    '',
    'If collection cannot be completed, complete the job with `status: "failed"` and a specific `error` or `summary`.',
  ].join('\n')
}

export function buildDailyDispatchStatusFragment({ status, issueId = '', taskId = '', reason = '' }) {
  const parts = [`dispatch=${status}`]
  if (issueId) parts.push(`multica_issue=${issueId}`)
  if (taskId) parts.push(`multica_task=${taskId}`)
  if (reason) parts.push(`reason=${reason}`)
  return `${parts.join('; ')}; `
}
```

- [ ] **Step 4: Run tests to verify green**

Run: `node --test server/swarm-daily.test.js`

Expected: PASS.

## Task 2: Active Multica Dispatch Outcomes

**Files:**
- Modify: `server/swarm-store.js`
- Test: add coverage through helper tests where possible; DB-backed behavior is verified by existing store tests and manual cron dry run when DB is configured.

- [ ] **Step 1: Write failing import/use test**

Add this assertion to `server/swarm-daily.test.js` inside the existing description test:

```js
assert.match(description, /Daily Telemetry Collection section in your SKILL.md/)
```

Run: `node --test server/swarm-daily.test.js`

Expected: PASS if Task 1 was completed correctly. If not, fix the helper before editing store code.

- [ ] **Step 2: Update store dispatch**

Modify imports in `server/swarm-store.js`:

```js
import {
  buildDailyCollectionJobTarget,
  buildDailyDispatchDescription,
  buildDailyDispatchStatusFragment,
  buildDailyTargetFromBatch,
  previousUtcDay,
} from './swarm-daily.js'
```

Replace `dispatchDailyRunToMultica()` with logic that:

```js
async function appendDailyRunDispatchStatus(runId, status) {
  await query(
    `UPDATE swarm_daily_runs
     SET missing_reason = COALESCE(missing_reason, '') || $1,
         updated_at = now()
     WHERE id = $2`,
    [buildDailyDispatchStatusFragment(status), runId]
  )
}
```

And:

```js
async function dispatchDailyRunToMultica({ target, day, runId, jobId }) {
  const multica = await import('./multica-db.js')
  if (!multica.hasMultica()) {
    await appendDailyRunDispatchStatus(runId, { status: 'skipped', reason: 'MULTICA_DATABASE_URL not configured' })
    return null
  }
  const workspace = await multica.getWorkspaceBySlug(target.workspace_slug)
  if (!workspace) {
    await appendDailyRunDispatchStatus(runId, { status: 'no_workspace', reason: `workspace ${target.workspace_slug} not found in Multica` })
    return null
  }
  const agent = await multica.findWorkspaceAgent(target.workspace_slug, [
    target.multica_agent_name,
    target.agent_key,
    target.agent_key.replace(/-/g, ' '),
  ])
  if (!agent?.runtime_id) {
    await appendDailyRunDispatchStatus(runId, { status: 'no_runtime', reason: `agent ${target.agent_key} runtime missing` })
    return null
  }

  const botId = await multica.getOrCreateGTMUser(workspace.id)
  const publicUrl = process.env.GTM_PUBLIC_URL || ''
  const issueId = await multica.createIssue(workspace.id, {
    title: `[Telemetry] ${target.agent_key} ${day}`,
    description: buildDailyDispatchDescription({ target, day, runId, jobId, publicUrl }),
    status: 'in_progress',
    priority: 'medium',
    creatorId: botId,
    assigneeId: agent.id,
  })
  const taskId = await multica.dispatchAgentTask(agent.id, agent.runtime_id, issueId, {
    triggerSummary: `Collect ${target.report_type} telemetry for ${target.agent_key} on ${day}`,
    priority: 3,
  })
  await appendDailyRunDispatchStatus(runId, { status: 'dispatched', issueId, taskId })
  return { issueId, taskId }
}
```

- [ ] **Step 3: Keep job creation resilient**

In `createDailyRunForTarget()`, keep the existing `.catch()` around dispatch and change the warning message only if needed. The daily job must still exist even when dispatch fails.

- [ ] **Step 4: Run focused tests**

Run: `node --test server/swarm-daily.test.js server/swarm-store.test.js`

Expected: PASS.

## Task 3: Agent Contract Documentation

**Files:**
- Modify: `gtm-swarm-cli/specs/agent-json-contract.md`
- Modify: `templates/contentos-agent/04-content-strategy.md`

- [ ] **Step 1: Add contract section**

In `gtm-swarm-cli/specs/agent-json-contract.md`, add a `collect_daily_telemetry` section explaining task fields, success completion, failed completion, and the requirement to follow agent `SKILL.md`.

- [ ] **Step 2: Add template skill guidance**

In `templates/contentos-agent/04-content-strategy.md`, add the same concise `Daily Telemetry Collection` section from the design spec so future generated agents know how to respond.

- [ ] **Step 3: Verify docs mention the task kind**

Run: `rg -n "collect_daily_telemetry|Daily Telemetry Collection" gtm-swarm-cli/specs/agent-json-contract.md templates/contentos-agent/04-content-strategy.md`

Expected: both files contain both concepts where appropriate.

## Task 4: Existing Agent Skills

**Files:**
- Modify: `projects/flatkey/agents/*/SKILL.md`

- [ ] **Step 1: Append shared telemetry section**

For each current `projects/flatkey/agents/*/SKILL.md`, append a `## Daily Telemetry Collection` section if it is not already present:

```md
## Daily Telemetry Collection

When assigned a GTM Swarm `collect_daily_telemetry` task:

1. Read `workspace`, `agent_key`, `platform`, `report_type`, `day`, `from`, `to`, `job_id`, and `daily_run_id`.
2. Collect metrics only for artifacts owned by this agent and platform.
3. Return observations using the `swarm.telemetry.v1` contract.
4. Complete the Swarm job with a success summary.
5. If collection cannot be completed, complete the job as failed with a specific reason.
```

- [ ] **Step 2: Verify every current flatkey agent has the section**

Run:

```bash
for f in projects/flatkey/agents/*/SKILL.md; do rg -q "## Daily Telemetry Collection" "$f" || echo "missing $f"; done
```

Expected: no output.

## Task 5: Final Verification

**Files:**
- All changed files.

- [ ] **Step 1: Run focused tests**

Run: `node --test server/swarm-daily.test.js server/swarm-store.test.js`

Expected: PASS.

- [ ] **Step 2: Run broader server tests**

Run: `node --test server/*.test.js`

Expected: PASS.

- [ ] **Step 3: Check worktree diff**

Run: `git status --short`

Expected: only planned files changed plus any pre-existing unrelated user changes.

- [ ] **Step 4: Commit implementation**

Run:

```bash
git add server/swarm-daily.js server/swarm-daily.test.js server/swarm-store.js gtm-swarm-cli/specs/agent-json-contract.md templates/contentos-agent/04-content-strategy.md projects/flatkey/agents
git commit -m "feat: dispatch daily telemetry tasks"
```

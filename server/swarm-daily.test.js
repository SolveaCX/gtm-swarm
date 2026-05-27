import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDailyCollectionJobTarget,
  buildDailyDispatchDescription,
  buildDailyDispatchStatusFragment,
  buildDailyTargetFromBatch,
  dayWindow,
  previousUtcDay,
} from './swarm-daily.js'

test('computes the previous UTC day', () => {
  assert.equal(previousUtcDay(new Date('2026-05-25T16:30:00Z')), '2026-05-24')
})

test('builds an inclusive UTC day window', () => {
  assert.deepEqual(dayWindow('2026-05-24'), {
    from: '2026-05-24T00:00:00.000Z',
    to: '2026-05-24T23:59:59.999Z',
  })
})

test('infers a daily MCP target from an ingest batch', () => {
  const target = buildDailyTargetFromBatch({
    workspace: 'voc-ai',
    agent_key: 'voc-amazon-reviews-mcp',
    artifacts: [{ platform: 'mcp' }],
    observations: [],
  })
  assert.deepEqual(target, {
    workspace: 'voc-ai',
    agent_key: 'voc-amazon-reviews-mcp',
    platform: 'mcp',
    report_type: 'mcp',
  })
})

test('builds a daily collection job target', () => {
  const jobTarget = buildDailyCollectionJobTarget({
    day: '2026-05-24',
    runId: 'run-1',
    target: { platform: 'mcp', report_type: 'mcp' },
  })
  assert.equal(jobTarget.daily_run_id, 'run-1')
  assert.equal(jobTarget.from, '2026-05-24T00:00:00.000Z')
  assert.equal(jobTarget.required_metrics.includes('p95_latency_ms'), true)
})

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
  assert.match(description, /Daily Telemetry Collection section in your SKILL.md/)
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

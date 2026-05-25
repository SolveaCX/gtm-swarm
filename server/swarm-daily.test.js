import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDailyCollectionJobTarget, buildDailyTargetFromBatch, dayWindow, previousUtcDay } from './swarm-daily.js'

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

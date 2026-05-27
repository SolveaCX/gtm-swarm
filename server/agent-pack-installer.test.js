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

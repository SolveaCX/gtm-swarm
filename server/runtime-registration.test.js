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

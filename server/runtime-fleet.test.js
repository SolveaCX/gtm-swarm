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

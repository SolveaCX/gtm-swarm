import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAgentTemplatePlan,
  buildRuntimeGuide,
  runtimeChannels,
} from './runtime-guide.js'

const fleet = {
  machines: {
    'mac-a': {
      name: 'Mac A',
      capabilities: ['shell', 'browser_cdp', 'x_automation', 'tiktok_publish'],
      listener: {
        command_template: 'gtm runtime listen --machine mac-a --workspace {{workspace}} --profiles {{profiles}}',
      },
    },
    'mac-b': {
      name: 'Mac B',
      capabilities: ['shell', 'seo_publish', 'image_generation'],
      listener: {
        command_template: 'gtm runtime listen --machine mac-b --workspace {{workspace}} --profiles {{profiles}}',
      },
    },
  },
  profiles: {
    'local-x-runtime': {
      capabilities: ['shell', 'browser_cdp', 'x_automation'],
      env_required: ['GTM_WRITES_TOKEN'],
      required_paths: ['x_agent'],
      preferred_machines: ['mac-a'],
    },
    'gtm-seo-runtime': {
      capabilities: ['shell', 'seo_publish', 'image_generation'],
      env_required: ['SOLVEA_API_KEY'],
      required_paths: ['gtm_skills'],
      preferred_machines: ['mac-b'],
    },
    'tiktok-runtime': {
      capabilities: ['shell', 'tiktok_publish'],
      env_required: ['TIKTOK_SESSION_PATH'],
      required_paths: ['video_workspace'],
      preferred_machines: ['mac-a'],
    },
    'influencer-runtime': {
      capabilities: ['shell'],
      env_required: ['GTM_WRITES_TOKEN'],
      required_paths: ['gtm_repo'],
      preferred_machines: ['mac-a'],
    },
  },
  agents: {
    'x-growth-agent': {
      name: 'X Growth Agent',
      description: 'Runs X',
      visibility: 'workspace',
      model: 'gpt-5.5',
      runtime_profile: 'local-x-runtime',
      skills: ['hunter-x-agent'],
      environment: { required: ['GTM_WRITES_TOKEN'] },
      local_paths: { required: ['x_agent'] },
      status_without_runtime: 'needs_runtime',
    },
  },
}

test('runtimeChannels covers requested GTM surfaces in display order', () => {
  assert.deepEqual(runtimeChannels.map(channel => channel.key), [
    'x',
    'reddit',
    'tiktok',
    'influencer',
    'seo',
  ])
  assert.equal(runtimeChannels.find(channel => channel.key === 'influencer')?.label, '红人营销')
})

test('buildRuntimeGuide recommends machines and renders workspace-specific commands', () => {
  const guide = buildRuntimeGuide(fleet, {
    workspaceSlug: 'voc-ai',
    runtimes: [{ id: 'rt-1', machine_key: 'mac-a', profile: 'local-x-runtime', status: 'online' }],
  })

  const x = guide.rows.find(row => row.channelKey === 'x')
  assert.equal(x.machineKey, 'mac-a')
  assert.equal(x.machineName, 'Mac A')
  assert.equal(x.runtimeId, 'rt-1')
  assert.equal(x.status, 'online')
  assert.equal(x.command, 'gtm runtime listen --machine mac-a --workspace voc-ai --profiles local-x-runtime')
  assert.deepEqual(x.requiredEnv, ['GTM_WRITES_TOKEN'])
  assert.deepEqual(x.requiredPaths, ['x_agent'])

  const seo = guide.rows.find(row => row.channelKey === 'seo')
  assert.equal(seo.machineKey, 'mac-b')
  assert.equal(seo.runtimeId, null)
})

test('buildAgentTemplatePlan preserves template dependencies and binds matching runtime', () => {
  const plan = buildAgentTemplatePlan(fleet, {
    templateKey: 'x-growth-agent',
    machineKey: 'mac-a',
    model: 'gpt-5',
    runtimes: [{ id: 'rt-1', machine_key: 'mac-a', profile: 'local-x-runtime', status: 'online' }],
  })

  assert.equal(plan.name, 'X Growth Agent')
  assert.equal(plan.model, 'gpt-5')
  assert.equal(plan.visibility, 'workspace')
  assert.equal(plan.runtimeId, 'rt-1')
  assert.equal(plan.status, 'idle')
  assert.deepEqual(plan.runtimeConfig.skills, ['hunter-x-agent'])
  assert.deepEqual(plan.runtimeConfig.environment.required, ['GTM_WRITES_TOKEN'])
  assert.deepEqual(plan.runtimeConfig.local_paths.required, ['x_agent'])
  assert.equal(plan.runtimeConfig.machine_key, 'mac-a')
})

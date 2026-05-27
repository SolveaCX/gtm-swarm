import { renderRegistrationCommand, selectMachineForProfile } from './runtime-fleet.js'

export const fixedRuntimeGuides = [
  {
    key: 'x',
    label: 'x',
    profile: 'local-x-runtime',
    templates: ['x-growth-agent'],
  },
  {
    key: 'reddit',
    label: 'reddit',
    profile: 'local-reddit-runtime',
    templates: ['reddit-growth-agent'],
  },
  {
    key: 'tiktok',
    label: 'tiktok',
    profile: 'tiktok-runtime',
    templates: ['tiktok-publisher-agent'],
  },
  {
    key: 'influencer',
    label: '红人营销',
    profile: 'influencer-runtime',
    templates: ['influencer-marketing-agent'],
  },
  {
    key: 'seo',
    label: 'SEO',
    profile: 'gtm-seo-runtime',
    templates: ['seo-blog-agent'],
  },
]

function asList(value) {
  return Array.isArray(value) ? value : []
}

function findRuntime(runtimes, profile, machineKey = '') {
  return asList(runtimes).find(runtime => {
    if (runtime.profile !== profile) return false
    if (machineKey && runtime.machine_key !== machineKey && runtime.machineKey !== machineKey) return false
    return true
  }) || null
}

function machineDisplayName(machineKey, machine) {
  return machine?.name || machine?.label || machineKey || ''
}

export function buildRuntimeGuide(runtimeConfig, {
  workspaceSlug = '',
  runtimes = [],
} = {}) {
  const machines = Object.entries(runtimeConfig.machines || {}).map(([key, machine]) => ({
    key,
    name: machineDisplayName(key, machine),
    capabilities: asList(machine.capabilities),
  }))

  const rows = fixedRuntimeGuides.map(runtime => {
    const profile = runtimeConfig.profiles[runtime.profile] || {}
    const selected = runtimeConfig.profiles[runtime.profile]
      ? selectMachineForProfile(runtimeConfig, runtime.profile)
      : { machineKey: null, machine: null, missingCapabilities: [] }
    const registered = findRuntime(runtimes, runtime.profile, selected.machineKey || '')
    const command = selected.machine
      ? renderRegistrationCommand(selected.machine, {
          workspace: workspaceSlug || '<workspace>',
          profiles: [runtime.profile],
        })
      : ''

    return {
      channelKey: runtime.key,
      label: runtime.label,
      profileKey: runtime.profile,
      templateKeys: runtime.templates,
      machineKey: selected.machineKey,
      machineName: machineDisplayName(selected.machineKey, selected.machine),
      runtimeId: registered?.id || null,
      status: registered?.status || (selected.machineKey ? 'not_registered' : 'missing_machine'),
      command,
      requiredEnv: asList(profile.env_required),
      requiredPaths: asList(profile.required_paths),
      missingCapabilities: asList(selected.missingCapabilities),
    }
  })

  const templates = Object.entries(runtimeConfig.agents || {}).map(([key, template]) => ({
    key,
    name: template.name,
    description: template.description,
    model: template.model,
    visibility: template.visibility || 'workspace',
    runtimeProfile: template.runtime_profile,
    skills: asList(template.skills),
    requiredEnv: asList(template.environment?.required),
    optionalEnv: asList(template.environment?.optional),
    requiredPaths: asList(template.local_paths?.required),
    optionalPaths: asList(template.local_paths?.optional),
  }))

  return { rows, machines, templates }
}

export function buildAgentTemplatePlan(runtimeConfig, {
  templateKey = '',
  name = '',
  model = '',
  machineKey = '',
  runtimes = [],
} = {}) {
  const template = runtimeConfig.agents?.[templateKey]
  if (!template) throw new Error(`agent template not found: ${templateKey}`)

  const runtimeId = findRuntime(runtimes, template.runtime_profile, machineKey)?.id || null
  const agentName = name.trim() || template.name
  const resolvedModel = model.trim() || template.model
  const visibility = template.visibility || 'workspace'

  return {
    templateKey,
    name: agentName,
    description: template.description,
    model: resolvedModel,
    visibility,
    runtimeProfile: template.runtime_profile,
    runtimeId,
    status: runtimeId ? 'idle' : (template.status_without_runtime || 'needs_runtime'),
    runtimeConfig: {
      agent_key: templateKey,
      runtime_profile: template.runtime_profile,
      model: resolvedModel,
      visibility,
      skills: asList(template.skills),
      description: template.description,
      environment: template.environment || { required: [], optional: [] },
      local_paths: template.local_paths || { required: [], optional: [] },
      machine_key: machineKey || null,
    },
  }
}

export function renderRuntimeSetupIssue({
  workspaceSlug,
  channelLabel,
  machineKey,
  profileKey,
  command,
  requiredEnv = [],
  requiredPaths = [],
}) {
  return [
    '## Runtime Setup',
    '',
    `Workspace: ${workspaceSlug}`,
    `Channel: ${channelLabel}`,
    `Machine: ${machineKey || 'not selected'}`,
    `Profile: ${profileKey}`,
    '',
    '### Run listener',
    '',
    '```bash',
    command,
    '```',
    '',
    '### Required environment',
    ...asList(requiredEnv).map(key => `- ${key}`),
    '',
    '### Required local paths',
    ...asList(requiredPaths).map(key => `- ${key}`),
  ].join('\n')
}

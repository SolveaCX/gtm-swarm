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
        environment: template.environment || { required: [], optional: [] },
        local_paths: template.local_paths || { required: [], optional: [] },
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

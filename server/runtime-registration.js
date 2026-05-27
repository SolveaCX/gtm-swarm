import { loadRuntimeFleet } from './runtime-fleet.js'
import { bindAgentsToRuntimeProfile, registerRuntimeListener } from './multica-db.js'

function statusFromPreflight(preflight) {
  if ((preflight.missingEnv || []).length) return 'needs_env'
  if ((preflight.missingPaths || []).length) return 'blocked_config'
  return 'online'
}

export async function registerMachineRuntime({
  workspace,
  machineKey,
  profiles,
  preflight,
  deps = { registerRuntimeListener, bindAgentsToRuntimeProfile },
}) {
  if (!workspace?.id) throw new Error('workspace.id is required')
  if (!machineKey) throw new Error('machineKey is required')
  if (!Array.isArray(profiles) || !profiles.length) throw new Error('profiles are required')

  const fleet = loadRuntimeFleet()
  const machine = fleet.machines[machineKey]
  if (!machine) throw new Error(`machine not found: ${machineKey}`)

  const status = statusFromPreflight(preflight || {})
  const runtimeIds = {}

  for (const profile of profiles) {
    if (!fleet.profiles[profile]) throw new Error(`runtime profile not found: ${profile}`)
    runtimeIds[profile] = await deps.registerRuntimeListener(workspace.id, {
      machineKey,
      profile,
      capabilities: machine.capabilities || [],
      status,
      health: preflight || {},
    })
    if (status === 'online') {
      await deps.bindAgentsToRuntimeProfile(workspace.id, {
        profile,
        runtimeId: runtimeIds[profile],
      })
    }
  }

  return { workspace: workspace.slug, machineKey, runtimeIds, status }
}

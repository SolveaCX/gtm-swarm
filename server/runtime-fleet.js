import path from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import yaml from 'js-yaml'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

function readYaml(relativePath) {
  return yaml.load(readFileSync(path.join(ROOT, relativePath), 'utf-8')) || {}
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))]
}

export function loadRuntimeFleet() {
  const machines = readYaml('config/runtime-machines.yaml').machines || {}
  const profiles = readYaml('config/runtime-profiles.yaml').profiles || {}
  const templateConfig = readYaml('config/agent-templates.yaml')
  return {
    machines,
    profiles,
    agentPacks: templateConfig.agent_packs || {},
    agents: templateConfig.agents || {},
  }
}

export function selectMachineForProfile(fleet, profileKey) {
  const profile = fleet.profiles[profileKey]
  if (!profile) throw new Error(`runtime profile not found: ${profileKey}`)

  const required = profile.capabilities || []
  const orderedKeys = uniq([
    ...(profile.preferred_machines || []),
    ...Object.keys(fleet.machines || {}),
  ])

  let aggregateMissing = []
  for (const machineKey of orderedKeys) {
    const machine = fleet.machines[machineKey]
    if (!machine) continue
    const caps = new Set(machine.capabilities || [])
    const missing = required.filter(cap => !caps.has(cap))
    if (!missing.length) {
      return { machineKey, machine, missingCapabilities: [] }
    }
    aggregateMissing.push(...missing)
  }

  return {
    machineKey: null,
    machine: null,
    missingCapabilities: uniq(aggregateMissing.length ? aggregateMissing : required),
  }
}

export function renderRegistrationCommand(machine, { workspace, profiles }) {
  const template = machine.listener?.command_template
  if (!template) throw new Error('machine listener.command_template is required')
  return template
    .replaceAll('{{workspace}}', workspace)
    .replaceAll('{{profiles}}', profiles.join(','))
}

export function buildRegistrationPlan(fleet, { workspace, agentKeys }) {
  const groups = new Map()
  const missing = []

  for (const agentKey of agentKeys) {
    const agent = fleet.agents[agentKey]
    if (!agent) throw new Error(`agent template not found: ${agentKey}`)
    const profileKey = agent.runtime_profile
    const selected = selectMachineForProfile(fleet, profileKey)
    if (!selected.machineKey) {
      missing.push({
        agentKey,
        agentName: agent.name,
        profile: profileKey,
        missingCapabilities: selected.missingCapabilities,
      })
      continue
    }
    if (!groups.has(selected.machineKey)) {
      groups.set(selected.machineKey, {
        machineKey: selected.machineKey,
        machine: selected.machine,
        profiles: [],
        agents: [],
      })
    }
    const group = groups.get(selected.machineKey)
    group.profiles = uniq([...group.profiles, profileKey])
    group.agents.push(agent.name)
  }

  const items = [...groups.values()].map(group => ({
    machineKey: group.machineKey,
    profiles: group.profiles,
    agents: group.agents,
    command: renderRegistrationCommand(group.machine, { workspace, profiles: group.profiles }),
  }))

  return { workspace, items, missing }
}

export function preflightMachine(fleet, machineKey, { env = process.env, exists = existsSync } = {}) {
  const machine = fleet.machines[machineKey]
  if (!machine) throw new Error(`machine not found: ${machineKey}`)

  const envRequired = machine.env_required || []
  const pathEntries = Object.entries(machine.paths || {})

  return {
    machineKey,
    presentEnv: envRequired.filter(key => Boolean(env[key])),
    missingEnv: envRequired.filter(key => !env[key]),
    presentPaths: pathEntries.filter(([, filePath]) => exists(filePath)).map(([key]) => key),
    missingPaths: pathEntries.filter(([, filePath]) => !exists(filePath)).map(([key]) => key),
  }
}

export function agentKeysForPack(fleet, packKey = 'gtm-core') {
  const pack = fleet.agentPacks[packKey]
  if (!pack) throw new Error(`agent pack not found: ${packKey}`)
  return pack.agents || []
}

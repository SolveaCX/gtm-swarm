'use client'
import { useEffect, useState, useCallback } from 'react'

export type BriefInfo = { step: number; key: string; exists: boolean; size: number }
export type ProjectMetaPayload = {
  project: string
  project_yaml: Record<string, unknown>
  state: { current_step: number; steps: Record<string, { status: string; size?: number; completed_at?: string; output_file?: string }> }
  briefs: BriefInfo[]
}

export function useProjectMeta(slug: string | undefined, refreshKey = 0) {
  const [data, setData] = useState<ProjectMetaPayload | null>(null)
  useEffect(() => {
    if (!slug) return
    fetch(`/api/project-meta?project=${slug}`).then(r => r.json()).then(setData)
  }, [slug, refreshKey])
  return data
}

export type StrategyBrief = { step: number; content: string }
export function useStrategyBrief(slug: string | undefined, step: number | null) {
  const [data, setData] = useState<StrategyBrief | null>(null)
  const fetchBrief = useCallback(async () => {
    if (!slug || step === null) return
    const r = await fetch(`/api/contentos/${slug}/strategy?step=${step}`).then(r => r.json())
    setData({ step, content: r.content || '' })
  }, [slug, step])
  useEffect(() => { fetchBrief() }, [fetchBrief])
  return data
}

export type AgentEntry = {
  id: string
  name?: string
  yaml: {
    name?: string
    category?: string
    platform?: string
    builder?: string
    reviewer?: string
    goal?: string
    default_product?: string
    kpi?: { weekly_target?: string; measure?: string }
    topics?: string[]
    activate?: boolean
    status?: string
  }
  metrics: {
    rolling_30d?: { drafted?: number; approved?: number; rejected?: number; published?: number }
  }
}

export type RuntimeGuideRow = {
  channelKey: string
  label: string
  profileKey: string
  templateKeys: string[]
  machineKey: string | null
  machineName: string
  runtimeId: string | null
  status: string
  command: string
  requiredEnv: string[]
  requiredPaths: string[]
  missingCapabilities: string[]
}

export type RuntimeMachine = {
  key: string
  name: string
  capabilities: string[]
}

export type AgentTemplate = {
  key: string
  name: string
  description: string
  model: string
  visibility: string
  runtimeProfile: string
  skills: string[]
  requiredEnv: string[]
  optionalEnv: string[]
  requiredPaths: string[]
  optionalPaths: string[]
}

export type RuntimeGuidePayload = {
  project: string
  multica_workspace_slug: string | null
  multica_configured: boolean
  rows: RuntimeGuideRow[]
  machines: RuntimeMachine[]
  templates: AgentTemplate[]
}

export function useAgents(slug: string | undefined, refreshKey = 0) {
  const [agents, setAgents] = useState<AgentEntry[]>([])
  useEffect(() => {
    if (!slug) return
    fetch(`/api/agents?project=${slug}`).then(r => r.json()).then(d => setAgents(d.agents || []))
  }, [slug, refreshKey])
  return agents
}

export function useRuntimeGuide(slug: string | undefined, refreshKey = 0) {
  const [data, setData] = useState<RuntimeGuidePayload | null>(null)
  useEffect(() => {
    if (!slug) return
    fetch(`/api/runtime/guide?project=${slug}`).then(r => r.json()).then(d => {
      if (d.error) setData(null)
      else setData(d)
    })
  }, [slug, refreshKey])
  return data
}

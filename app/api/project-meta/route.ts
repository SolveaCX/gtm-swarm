import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import matter from 'gray-matter'
import { PROJECTS_DIR } from '@/lib/fs-api'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project') || ''
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  if (!project) return NextResponse.json({ error: 'project required' }, { status: 400 })
  const ws = await store.getWorkspace(project)
  if (!ws) return NextResponse.json({ error: 'project not found' }, { status: 404 })

  const projectDir = path.join(PROJECTS_DIR, project)
  const projectYamlPath = path.join(projectDir, 'project.yaml')
  let projectYaml: Record<string, unknown> = {
    ...(typeof ws.project_config === 'string' ? JSON.parse(ws.project_config || '{}') : ws.project_config || {}),
    name: ws.name,
    slug: ws.slug,
  }
  if (existsSync(projectYamlPath)) {
    try { projectYaml = (matter('---\n' + readFileSync(projectYamlPath, 'utf-8') + '\n---\n').data) as Record<string, unknown> } catch {}
  }

  const state = await store.getContentOSState(ws.id) || { current_step: 0, steps: {} }

  const map: Array<[number, string]> = [
    [1, '01-market-insight'], [2, '02-user-insight'],
    [3, '03-competitor-analysis'], [4, '04-content-strategy'],
  ]
  const briefs = await Promise.all(map.map(async ([step, key]) => {
    const doc = await store.getStrategyDoc(ws.id, key)
    return { step, key, exists: Boolean(doc), size: doc?.content?.length || 0 }
  }))
  return NextResponse.json({ project, project_yaml: projectYaml, state, briefs })
}

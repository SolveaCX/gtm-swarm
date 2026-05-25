import { NextRequest, NextResponse } from 'next/server'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { PROJECTS_DIR } from '@/lib/fs-api'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'
import { hasMultica } from '@/server/multica-db.js'
import { ensureProjectScaffold } from '@/server/contentos.js'

export async function GET() {
  if (!hasDB()) return NextResponse.json({ error: 'no database' })
  try {
    await store.ensureWorkspaceSwarmTokens()
    const workspaces = await store.listWorkspaces()
    const result = []
    for (const ws of workspaces) {
      const cosState = await store.getContentOSState(ws.id)
      result.push({ ...ws, contentos_state: cosState })
    }
    return NextResponse.json(result)
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { slug, name, urls = {}, project_config = {} } = await request.json()
    if (!slug || !name) return NextResponse.json({ error: 'slug and name required' }, { status: 400 })

    if (hasDB()) {
      let ws = await store.createWorkspace({ slug, name, urls, project_config, lifecycle_state: 'onboarding' })
      await store.saveContentOSState(ws.id, { current_step: 0, steps: {} })
      ensureProjectScaffold({ slug, name, urls, project_config })
      if (hasMultica()) {
        const { getOrCreateWorkspace } = await import('@/server/multica-db.js')
        await getOrCreateWorkspace(slug, name)
        ws = await store.bindMulticaWorkspace(slug, slug)
      }
      return NextResponse.json(ws)
    }

    const projectDir = path.join(PROJECTS_DIR, slug)
    if (existsSync(projectDir)) return NextResponse.json({ error: 'slug already exists' }, { status: 409 })
    mkdirSync(path.join(projectDir, 'strategy'), { recursive: true })
    mkdirSync(path.join(projectDir, 'agents'), { recursive: true })

    const projData = {
      slug, name,
      url: (urls as Record<string, string>).website || (project_config as Record<string, string>).url || '',
      github_kb: (urls as Record<string, string>).github_kb || '',
      category: (project_config as Record<string, string>).category || '',
      tagline: (project_config as Record<string, string>).tagline || '',
      status: 'active',
    }
    writeFileSync(path.join(projectDir, 'project.yaml'), yaml.dump(projData, { lineWidth: 0, sortKeys: false }))

    const regPath = path.join(PROJECTS_DIR, '_registry.json')
    let reg: Record<string, unknown> = {}
    try { reg = JSON.parse(readFileSync(regPath, 'utf-8')) } catch {}
    if (!reg.projects) reg.projects = {}
    if (!reg.default) reg.default = slug;
    (reg.projects as Record<string, unknown>)[slug] = { slug, name, url: projData.url, status: 'active' }
    writeFileSync(regPath, JSON.stringify(reg, null, 2))

    return NextResponse.json({ slug, name, lifecycle_state: 'onboarding', ...projData })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

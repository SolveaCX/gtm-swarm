import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PROJECTS_DIR } from '@/lib/fs-api'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  const projectDir = path.join(PROJECTS_DIR, slug)
  const ws = await store.getWorkspace(slug)
  if (!ws) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const state = await store.getContentOSState(ws.id) || { current_step: 0, steps: {} }
  const project = existsSync(path.join(projectDir, 'project.yaml'))
    ? readFileSync(path.join(projectDir, 'project.yaml'), 'utf-8') : ''
  return NextResponse.json({ slug, state, project_yaml: project })
}

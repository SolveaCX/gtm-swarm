import { NextRequest, NextResponse } from 'next/server'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { hasDB } from '@/server/db.js'
import { getWorkspace, saveWorkspaceCIAResult } from '@/server/store.js'
import { PROJECTS_DIR } from '@/server/paths.js'
import { startMissingContentOSStepsJob } from '@/server/contentos-jobs.js'

export async function POST(request: NextRequest) {
  // Auth
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!process.env.CIA_HUB_TOKEN || token !== process.env.CIA_HUB_TOKEN) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  if (!hasDB()) return NextResponse.json({ error: 'DATABASE_URL required' }, { status: 503 })

  const body = await request.json().catch(() => null)
  if (!body?.slug || !body?.synthesis) {
    return NextResponse.json({ error: 'slug and synthesis required' }, { status: 400 })
  }

  try {
    const ws = await getWorkspace(body.slug)
    if (!ws) return NextResponse.json({ error: 'workspace not found' }, { status: 404 })

    const result = {
      ...body.synthesis,
      analyzed_at: body.analyzed_at || new Date().toISOString(),
    }
    const regenerateContentOS = body.regenerate_contentos !== false
    await saveWorkspaceCIAResult(body.slug, result)

    // Write synthesis.md to filesystem for Python contentos-agent.py path
    if (result.synthesis_md) {
      try {
        const ciaDir = path.join(PROJECTS_DIR, body.slug, 'cia')
        mkdirSync(ciaDir, { recursive: true })
        writeFileSync(path.join(ciaDir, 'synthesis.md'), result.synthesis_md)
      } catch (e) {
        console.warn('[cia/result] synthesis.md write failed (non-fatal):', (e as Error).message)
      }
    }

    const job = await startMissingContentOSStepsJob(body.slug, { force: regenerateContentOS })

    return NextResponse.json({
      ok: true,
      updated: true,
      regenerate_contentos: regenerateContentOS,
      job,
    }, { status: 202 })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

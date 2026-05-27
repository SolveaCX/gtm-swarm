import { NextRequest, NextResponse } from 'next/server'
import { hasMultica, getWorkspaceBySlug } from '@/server/multica-db.js'
import { registerMachineRuntime } from '@/server/runtime-registration.js'

function bearer(request: NextRequest) {
  const header = request.headers.get('authorization') || ''
  return header.startsWith('Bearer ') ? header.slice(7) : ''
}

export async function POST(request: NextRequest) {
  try {
    if (!hasMultica()) {
      return NextResponse.json({ error: 'multica not configured' }, { status: 503 })
    }
    const token = bearer(request)
    if (!token || token !== process.env.GTM_WRITES_TOKEN) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const workspace = await getWorkspaceBySlug(body.workspace)
    if (!workspace) {
      return NextResponse.json({ error: `workspace not found: ${body.workspace}` }, { status: 404 })
    }

    const result = await registerMachineRuntime({
      workspace,
      machineKey: body.machine,
      profiles: body.profiles,
      preflight: body.preflight,
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

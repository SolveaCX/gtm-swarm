import { NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'
import { NO_STORE_HEADERS } from '@/server/workspace-public.js'

export async function GET() {
  // Project list always comes from GTM DB.
  if (hasDB()) {
    await store.ensureWorkspaceSwarmTokens()
    const rows = await store.listWorkspaces()
    const projects = Object.fromEntries(rows.map((ws: { slug: string; name: string }) => [
      ws.slug, { slug: ws.slug, name: ws.name, url: '', category: '', tagline: '', status: 'active' }
    ]))
    return NextResponse.json(
      { registry: { projects, default: rows[0]?.slug }, discovered: rows.map((ws: { slug: string }) => ws.slug) },
      { headers: NO_STORE_HEADERS },
    )
  }
  return NextResponse.json(
    { registry: { projects: {}, default: null }, discovered: [] },
    { headers: NO_STORE_HEADERS },
  )
}

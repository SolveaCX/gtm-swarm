import { NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'

export async function GET() {
  // Project list always comes from GTM DB.
  if (hasDB()) {
    await store.ensureWorkspaceSwarmTokens()
    const rows = await store.listWorkspaces()
    const projects = Object.fromEntries(rows.map((ws: { slug: string; name: string; swarm_token?: string }) => [
      ws.slug, { slug: ws.slug, name: ws.name, url: '', category: '', tagline: '', status: 'active', swarm_token: ws.swarm_token }
    ]))
    return NextResponse.json({ registry: { projects, default: rows[0]?.slug }, discovered: rows.map((ws: { slug: string }) => ws.slug) })
  }
  return NextResponse.json({ registry: { projects: {}, default: null }, discovered: [] })
}

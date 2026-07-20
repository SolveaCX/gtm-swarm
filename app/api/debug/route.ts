import { NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import { hasMultica } from '@/server/multica-db.js'
import { NO_STORE_HEADERS } from '@/server/workspace-public.js'

export async function GET() {
  const result: Record<string, unknown> = {
    hasDB: hasDB(),
    hasMultica: hasMultica(),
  }

  if (hasMultica()) {
    try {
      const { listAllWorkspaces } = await import('@/server/multica-db.js')
      result.multica_workspaces = await listAllWorkspaces()
    } catch (e: unknown) {
      result.multica_error = (e as Error).message
    }
  }

  if (hasDB()) {
    try {
      const store = await import('@/server/store.js')
      result.gtm_workspaces = await store.listWorkspaces()
    } catch (e: unknown) {
      result.gtm_db_error = (e as Error).message
    }
  }

  return NextResponse.json(result, { headers: NO_STORE_HEADERS })
}

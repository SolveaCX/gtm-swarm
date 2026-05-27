import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'

const STEP_KEYS: Record<string, string> = {
  '1': '01-market-insight', '2': '02-user-insight',
  '3': '03-competitor-analysis', '4': '04-content-strategy',
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const step = request.nextUrl.searchParams.get('step')
  if (!step || !STEP_KEYS[step]) return NextResponse.json({ error: 'step 1..4 required' }, { status: 400 })
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  const fname = STEP_KEYS[step]

  const ws = await store.getWorkspace(slug)
  if (!ws) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const doc = await store.getStrategyDoc(ws.id, fname)
  return NextResponse.json({ step, exists: Boolean(doc), content: doc?.content || '' })
}

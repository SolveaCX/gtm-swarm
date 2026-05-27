import { NextRequest, NextResponse } from 'next/server'
import { hasDB } from '@/server/db.js'
import * as store from '@/server/store.js'

const STEP_KEYS: Record<string, string> = {
  '1': '01-market-insight', '2': '02-user-insight',
  '3': '03-competitor-analysis', '4': '04-content-strategy',
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const step = request.nextUrl.searchParams.get('step')
  if (!step || !STEP_KEYS[step]) return NextResponse.json({ error: 'bad step' }, { status: 400 })
  if (!hasDB()) return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  try {
    const { content } = await request.json()
    const ws = await store.getWorkspace(slug)
    if (!ws) return NextResponse.json({ error: 'not found' }, { status: 404 })
    await store.saveStrategyDoc(ws.id, STEP_KEYS[step], content)
    await store.markContentOSStepDone(ws.id, STEP_KEYS[step], {
      currentStep: Number(step),
      outputFile: `strategy_docs:${STEP_KEYS[step]}`,
      size: content.length,
    })
    return NextResponse.json({ ok: true, size: content.length })
  } catch (e: unknown) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

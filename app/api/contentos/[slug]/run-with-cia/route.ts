import { NextRequest, NextResponse } from 'next/server'
import { startContentOSStepJob } from '@/server/contentos-jobs.js'
import { hasAnthropic } from '@/server/llm.js'
import { hasDB } from '@/server/db.js'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const step = _req.nextUrl.searchParams.get('step')
  if (!step || !['1', '2', '3', '4'].includes(step)) {
    return NextResponse.json({ error: 'step 1..4 required' }, { status: 400 })
  }
  if (!hasAnthropic()) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or FLATKEY_API_KEY not configured' }, { status: 503 })
  }
  if (!hasDB()) {
    return NextResponse.json({ error: 'GTM_DATABASE required' }, { status: 503 })
  }
  try {
    const job = await startContentOSStepJob(slug, Number(step))
    return NextResponse.json({
      ok: true,
      status: job.status,
      started: job.started,
      step: Number(step),
    }, { status: 202 })
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

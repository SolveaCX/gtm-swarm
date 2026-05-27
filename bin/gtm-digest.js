#!/usr/bin/env node
// gtm-digest — build + optionally push the daily Ideas Pool digest.
//
// Usage:
//   gtm-digest                          print digest markdown to stdout
//   gtm-digest --push                   also POST to DingTalk webhook
//   gtm-digest --since-h 48             custom window (default 24)
//
// Requires GTM_DINGTALK_WEBHOOK env var to push.

import { buildDailyDigest, formatDigestMarkdown } from '../server/digest.js'
import { pushMarkdown, hasDingTalk } from '../server/dingtalk.js'

const args = process.argv.slice(2)
const push = args.includes('--push')
const sinceIdx = args.indexOf('--since-h')
const sinceHours = sinceIdx >= 0 ? parseInt(args[sinceIdx + 1], 10) : 24

const publicUrl = process.env.GTM_PUBLIC_URL || 'https://gtm.shulex.com'
const digest = buildDailyDigest({ sinceHours, publicUrl })
const md = formatDigestMarkdown(digest)
console.log(md)

if (push) {
  if (!hasDingTalk()) {
    console.error('\nERROR: GTM_DINGTALK_WEBHOOK not set; cannot push.')
    process.exit(1)
  }
  const r = await pushMarkdown(`GTM Swarm Daily — ${digest.ts.slice(0, 10)}`, md)
  if (!r.ok) { console.error('push failed:', r); process.exit(1) }
  console.log('\n✓ pushed to DingTalk')
}

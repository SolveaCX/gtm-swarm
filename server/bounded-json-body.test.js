import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { readBoundedJsonBody } from './bounded-json-body.js'

test('rejects a declared oversized body before opening the request stream', async () => {
  let opened = false
  const request = {
    headers: new Headers({ 'content-length': '33' }),
    body: {
      getReader() {
        opened = true
        throw new Error('body must not be read')
      },
    },
  }

  const result = await readBoundedJsonBody(request, 32)
  assert.deepEqual(result, {
    ok: false,
    status: 413,
    error: 'request body cannot exceed 32 bytes',
  })
  assert.equal(opened, false)
})

test('rejects a chunked body when streamed bytes exceed the limit', async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"value":"'))
      controller.enqueue(new TextEncoder().encode('x'.repeat(32)))
      controller.enqueue(new TextEncoder().encode('"}'))
      controller.close()
    },
  })
  const request = new Request('https://example.test/ingest', {
    method: 'POST',
    body: stream,
    duplex: 'half',
  })

  const result = await readBoundedJsonBody(request, 32)
  assert.equal(result.ok, false)
  assert.equal(result.status, 413)
})

test('does not trust a forged smaller content-length', async () => {
  const request = new Request('https://example.test/ingest', {
    method: 'POST',
    headers: { 'content-length': '2' },
    body: JSON.stringify({ value: 'x'.repeat(32) }),
  })

  const result = await readBoundedJsonBody(request, 32)
  assert.equal(result.ok, false)
  assert.equal(result.status, 413)
})

test('parses valid bounded JSON and rejects malformed JSON', async () => {
  const valid = await readBoundedJsonBody(new Request('https://example.test/ingest', {
    method: 'POST',
    body: JSON.stringify({ ok: true }),
  }), 32)
  assert.deepEqual(valid, { ok: true, value: { ok: true } })

  const invalid = await readBoundedJsonBody(new Request('https://example.test/ingest', {
    method: 'POST',
    body: '{',
  }), 32)
  assert.equal(invalid.ok, false)
  assert.equal(invalid.status, 400)
})

test('telemetry ingest and job completion routes enforce the bounded raw JSON reader', () => {
  for (const routePath of [
    'app/api/swarm/ingest/route.ts',
    'app/api/swarm/jobs/[id]/complete/route.ts',
  ]) {
    const route = readFileSync(path.join(process.cwd(), routePath), 'utf8')
    assert.match(route, /readBoundedJsonBody\(request, MAX_TELEMETRY_BYTES\)/)
    assert.match(route, /status: parsed\.status/)
    assert.doesNotMatch(route, /request\.json\(/)
  }
})

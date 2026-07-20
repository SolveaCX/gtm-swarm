function fail(status, error) {
  return { ok: false, status, error }
}

function declaredContentLength(request) {
  const value = request.headers.get('content-length')
  if (value === null) return { ok: true, length: null }

  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) return fail(400, 'content-length must be a non-negative integer')

  try {
    return { ok: true, length: BigInt(normalized) }
  } catch {
    return fail(400, 'content-length must be a non-negative integer')
  }
}

export async function readBoundedJsonBody(request, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError('maxBytes must be a positive safe integer')
  }

  const declared = declaredContentLength(request)
  if (!declared.ok) return declared
  if (declared.length !== null && declared.length > BigInt(maxBytes)) {
    return fail(413, `request body cannot exceed ${maxBytes} bytes`)
  }

  if (!request.body) return fail(400, 'request body must be valid JSON')

  let reader
  try {
    reader = request.body.getReader()
  } catch {
    return fail(400, 'request body must be valid JSON')
  }

  const chunks = []
  let total = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value)
      total += chunk.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        return fail(413, `request body cannot exceed ${maxBytes} bytes`)
      }
      chunks.push(chunk)
    }
  } catch {
    return fail(400, 'request body must be valid JSON')
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return fail(400, 'request body must be valid UTF-8 JSON')
  }

  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return fail(400, 'request body must be valid JSON')
  }
}

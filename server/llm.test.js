import test from 'node:test'
import assert from 'node:assert/strict'

test('complete fails clearly when no Anthropic credential is configured', async () => {
  const oldApiKey = process.env.ANTHROPIC_API_KEY
  const oldAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
  const oldFlatkeyApiKey = process.env.FLATKEY_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.FLATKEY_API_KEY

  try {
    const { complete } = await import(`./llm.js?test=${Date.now()}`)
    await assert.rejects(
      () => complete('hello', { maxTokens: 10 }),
      /ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or FLATKEY_API_KEY not configured/
    )
  } finally {
    if (oldApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = oldApiKey
    if (oldAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = oldAuthToken
    if (oldFlatkeyApiKey === undefined) delete process.env.FLATKEY_API_KEY
    else process.env.FLATKEY_API_KEY = oldFlatkeyApiKey
  }
})

test('hasAnthropic accepts FLATKEY_API_KEY for the default Flatkey base URL', async () => {
  const oldApiKey = process.env.ANTHROPIC_API_KEY
  const oldAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
  const oldFlatkeyApiKey = process.env.FLATKEY_API_KEY
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  process.env.FLATKEY_API_KEY = 'flatkey-test-key'

  try {
    const { DEFAULT_BASE_URL, hasAnthropic } = await import(`./llm.js?test=${Date.now()}`)
    assert.equal(hasAnthropic(), true)
    assert.equal(DEFAULT_BASE_URL, 'https://router.flatkey.ai')
  } finally {
    if (oldApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = oldApiKey
    if (oldAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = oldAuthToken
    if (oldFlatkeyApiKey === undefined) delete process.env.FLATKEY_API_KEY
    else process.env.FLATKEY_API_KEY = oldFlatkeyApiKey
  }
})

test('completion continues when provider stops at max_tokens', async () => {
  const calls = []
  const fakeClient = {
    messages: {
      create: async body => {
        calls.push(body)
        if (calls.length === 1) {
          return {
            content: [{ type: 'text', text: 'first half' }],
            usage: { input_tokens: 10, output_tokens: 5 },
            stop_reason: 'max_tokens',
          }
        }
        return {
          content: [{ type: 'text', text: ' second half' }],
          usage: { input_tokens: 3, output_tokens: 4 },
          stop_reason: 'end_turn',
        }
      },
    },
  }

  const { runCompletionLoop } = await import(`./llm.js?test=${Date.now()}`)
  const result = await runCompletionLoop(fakeClient, 'write a long brief', { model: 'test-model', maxTokens: 20 })

  assert.equal(result.text, 'first half second half')
  assert.equal(result.stopReason, 'end_turn')
  assert.equal(result.continuations, 1)
  assert.deepEqual(result.usage, { input_tokens: 13, output_tokens: 9 })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].messages[0].role, 'user')
  assert.equal(calls[1].messages[1].role, 'assistant')
  assert.equal(calls[1].messages[1].content, 'first half')
  assert.equal(calls[1].messages[2].role, 'user')
})

test('completion uses streaming when the provider client supports it', async () => {
  const calls = []
  const fakeClient = {
    messages: {
      stream: body => {
        calls.push(body)
        return {
          finalMessage: async () => ({
            content: [{ type: 'text', text: 'streamed response' }],
            usage: { input_tokens: 7, output_tokens: 3 },
            stop_reason: 'end_turn',
          }),
        }
      },
      create: async () => {
        throw new Error('non-streaming create should not be used')
      },
    },
  }

  const { runCompletionLoop } = await import(`./llm.js?test=${Date.now()}`)
  const result = await runCompletionLoop(fakeClient, 'write a long brief', { model: 'test-model', maxTokens: 20 })

  assert.equal(result.text, 'streamed response')
  assert.equal(result.stopReason, 'end_turn')
  assert.deepEqual(result.usage, { input_tokens: 7, output_tokens: 3 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'test-model')
  assert.equal(calls[0].max_tokens, 20)
})

test('completion fails instead of silently returning incomplete text after continuation limit', async () => {
  const fakeClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: 'partial' }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: 'max_tokens',
      }),
    },
  }

  const { runCompletionLoop } = await import(`./llm.js?test=${Date.now()}`)
  await assert.rejects(
    () => runCompletionLoop(fakeClient, 'write a long brief', { model: 'test-model', maxTokens: 20, maxContinuations: 1 }),
    /stopped at max_tokens after 1 continuation/
  )
})

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
    const { hasAnthropic } = await import(`./llm.js?test=${Date.now()}`)
    assert.equal(hasAnthropic(), true)
  } finally {
    if (oldApiKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = oldApiKey
    if (oldAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = oldAuthToken
    if (oldFlatkeyApiKey === undefined) delete process.env.FLATKEY_API_KEY
    else process.env.FLATKEY_API_KEY = oldFlatkeyApiKey
  }
})

import Anthropic from '@anthropic-ai/sdk'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6'
export const DEFAULT_BASE_URL = 'https://router.flatkey.ai'
const BASE_URL = process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL
const DEFAULT_MAX_CONTINUATIONS = 3

function getKey() {
  return process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.FLATKEY_API_KEY || ''
}

export function hasAnthropic() {
  return Boolean(getKey())
}

let client = null
export async function complete(prompt, opts = {}) {
  const key = getKey()
  if (!key) throw new Error('ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or FLATKEY_API_KEY not configured')
  if (!client) {
    client = new Anthropic({ apiKey: key, baseURL: BASE_URL })
  }
  return runCompletionLoop(client, prompt, opts)
}

export async function runCompletionLoop(llmClient, prompt, opts = {}) {
  const model = opts.model || MODEL
  const maxTokens = opts.maxTokens || 16000
  const maxContinuations = opts.maxContinuations ?? DEFAULT_MAX_CONTINUATIONS
  const messages = [{ role: 'user', content: prompt }]
  let text = ''
  let usage = null
  let stopReason = null
  let continuations = 0

  for (let attempt = 0; attempt <= maxContinuations; attempt += 1) {
    const body = {
      model,
      max_tokens: maxTokens,
      messages,
    }
    const msg = await createMessage(llmClient, body)
    const chunk = extractText(msg)
    text += chunk
    usage = mergeUsage(usage, msg.usage)
    stopReason = msg.stop_reason

    if (stopReason !== 'max_tokens') {
      return { text, usage, stopReason, continuations }
    }

    if (attempt === maxContinuations) {
      if (opts.allowIncomplete) return { text, usage, stopReason, continuations, incomplete: true }
      const suffix = continuations === 1 ? 'continuation' : 'continuations'
      throw new Error(`LLM response stopped at max_tokens after ${continuations} ${suffix}; refusing to return incomplete text`)
    }

    continuations += 1
    messages.push({ role: 'assistant', content: text })
    messages.push({
      role: 'user',
      content: 'Continue exactly from where the previous response stopped. Do not repeat earlier text. Do not add a preface.',
    })
  }

  return { text, usage, stopReason, continuations, incomplete: stopReason === 'max_tokens' }
}

async function createMessage(llmClient, body) {
  if (typeof llmClient.messages.stream === 'function') {
    return llmClient.messages.stream(body).finalMessage()
  }
  return llmClient.messages.create(body)
}

function extractText(msg) {
  const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('')
  return text
}

function mergeUsage(total, next) {
  if (!next) return total
  const merged = { ...(total || {}) }
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'number') merged[key] = (merged[key] || 0) + value
  }
  return merged
}

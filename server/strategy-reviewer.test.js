import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStrategyReviewPrompt,
  parseStrategyReviewResponse,
} from './strategy-reviewer.js'

test('buildStrategyReviewPrompt includes project, metrics, and issue context', () => {
  const prompt = buildStrategyReviewPrompt({
    project: 'voc-ai',
    metricsSummary: 'Traffic up 12%, registrations flat.',
    issueSummary: 'Reddit draft rejected twice for product-heavy language.',
    artifactSummary: 'Top post used pain-first hook.',
  })

  assert.match(prompt, /voc-ai/)
  assert.match(prompt, /Traffic up 12%/)
  assert.match(prompt, /Reddit draft rejected twice/)
  assert.match(prompt, /Return ONLY valid JSON/)
})

test('buildStrategyReviewPrompt does not include union syntax inside JSON example', () => {
  const prompt = buildStrategyReviewPrompt({ project: 'voc-ai' })

  assert.doesNotMatch(prompt, /"execution_task"\s*\|/)
  assert.doesNotMatch(prompt, /"project"\s*\|\s*"global"/)
})

test('parseStrategyReviewResponse normalizes proposals from JSON', () => {
  const proposals = parseStrategyReviewResponse(JSON.stringify({
    proposals: [{
      type: 'memory_update',
      project: 'voc-ai',
      title: 'Add speed objection',
      summary: 'Users worry analysis is slow.',
      evidence: [{ kind: 'note', reference: 'review comments' }],
    }],
  }))

  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].type, 'memory_update')
  assert.equal(proposals[0].requires_human_approval, true)
})

test('parseStrategyReviewResponse accepts fenced JSON with leading whitespace and spaced uppercase fence', () => {
  const proposals = parseStrategyReviewResponse(`
  \`\`\` JSON
{
  "proposals": [{
    "type": "experiment_task",
    "project": "voc-ai",
    "title": "Test shorter posts",
    "summary": "Compare concise hooks against current variants."
  }]
}
\`\`\``)

  assert.equal(proposals.length, 1)
  assert.equal(proposals[0].type, 'experiment_task')
})

test('parseStrategyReviewResponse accepts bare fenced JSON', () => {
  const proposals = parseStrategyReviewResponse(`\`\`\`
{"proposals":[]}
\`\`\``)

  assert.deepEqual(proposals, [])
})

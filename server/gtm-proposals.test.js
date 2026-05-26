import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeProposal,
  renderProposalMarkdown,
  proposalIssueTitle,
} from './gtm-proposals.js'

test('normalizes a valid SOP change proposal', () => {
  const proposal = normalizeProposal({
    type: 'sop_change',
    project: 'voc-ai',
    target_scope: 'project',
    target_agent_type: 'reddit',
    target_file: 'projects/voc-ai/sop/reddit.md',
    title: 'Prefer pain-first hooks',
    summary: 'Pain-first hooks produced stronger comment depth.',
    evidence: [{ kind: 'metric', reference: 'comment depth +42%' }],
    risk: 'medium',
    confidence: 'medium',
    requires_human_approval: true,
    expected_effect: 'Improve Reddit reply rate.',
    rollback_plan: 'Remove override if next 5 posts underperform.',
  })

  assert.equal(proposal.type, 'sop_change')
  assert.equal(proposal.requires_human_approval, true)
  assert.equal(proposal.evidence.length, 1)
})

test('rejects unknown proposal type', () => {
  assert.throws(
    () => normalizeProposal({ type: 'random', project: 'voc-ai', title: 'Bad' }),
    /invalid proposal type/
  )
})

test('renders proposal markdown with evidence and rollback plan', () => {
  const proposal = normalizeProposal({
    type: 'memory_update',
    project: 'voc-ai',
    target_scope: 'project',
    target_agent_type: 'research',
    target_file: 'projects/voc-ai/memory/audience.md',
    title: 'Add speed objection',
    summary: 'Users worry review analysis takes too long.',
    evidence: [{ kind: 'artifact', reference: 'multica://issue/abc' }],
    risk: 'low',
    confidence: 'high',
    requires_human_approval: true,
    expected_effect: 'Improve objection handling.',
    rollback_plan: 'Remove memory entry.',
  })

  const md = renderProposalMarkdown(proposal)
  assert.match(md, /## GTM Proposal/)
  assert.match(md, /type: memory_update/)
  assert.match(md, /multica:\/\/issue\/abc/)
  assert.match(md, /Remove memory entry/)
})

test('builds stable issue titles', () => {
  const proposal = normalizeProposal({
    type: 'experiment_task',
    project: 'voc-ai',
    title: 'Test pain-first hooks',
    summary: 'Compare variants.',
  })
  assert.equal(proposalIssueTitle(proposal), '[experiment_task] Test pain-first hooks')
})

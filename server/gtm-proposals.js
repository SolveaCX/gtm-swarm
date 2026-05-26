const TYPES = new Set(['execution_task', 'experiment_task', 'memory_update', 'sop_change'])
const SCOPES = new Set(['project', 'global'])
const LEVELS = new Set(['low', 'medium', 'high'])

function requiredString(value, field) {
  const s = String(value || '').trim()
  if (!s) throw new Error(`${field} is required`)
  return s
}

function normalizeEvidence(rows) {
  if (!Array.isArray(rows)) return []
  return rows
    .map(row => ({
      kind: String(row?.kind || 'note').trim() || 'note',
      reference: String(row?.reference || '').trim(),
    }))
    .filter(row => row.reference)
}

export function normalizeProposal(input = {}) {
  const type = requiredString(input.type, 'type')
  if (!TYPES.has(type)) throw new Error(`invalid proposal type: ${type}`)

  const project = requiredString(input.project, 'project')
  const title = requiredString(input.title, 'title')
  const targetScope = String(input.target_scope || 'project').trim()
  if (!SCOPES.has(targetScope)) throw new Error(`invalid target_scope: ${targetScope}`)

  const risk = String(input.risk || 'medium').trim()
  if (!LEVELS.has(risk)) throw new Error(`invalid risk: ${risk}`)

  const confidence = String(input.confidence || 'medium').trim()
  if (!LEVELS.has(confidence)) throw new Error(`invalid confidence: ${confidence}`)

  return {
    type,
    project,
    target_scope: targetScope,
    target_agent_type: String(input.target_agent_type || '').trim(),
    target_file: String(input.target_file || '').trim(),
    title,
    summary: String(input.summary || '').trim(),
    evidence: normalizeEvidence(input.evidence),
    risk,
    confidence,
    requires_human_approval: input.requires_human_approval !== false,
    expected_effect: String(input.expected_effect || '').trim(),
    rollback_plan: String(input.rollback_plan || '').trim(),
  }
}

export function proposalIssueTitle(proposal) {
  return `[${proposal.type}] ${proposal.title}`.slice(0, 180)
}

export function renderProposalMarkdown(proposal) {
  const evidence = proposal.evidence.length
    ? proposal.evidence.map(e => `- ${e.kind}: ${e.reference}`).join('\n')
    : '- note: No evidence supplied'

  return [
    '## GTM Proposal',
    '',
    '```yaml',
    `type: ${proposal.type}`,
    `project: ${proposal.project}`,
    `target_scope: ${proposal.target_scope}`,
    `target_agent_type: ${proposal.target_agent_type}`,
    `target_file: ${proposal.target_file}`,
    `risk: ${proposal.risk}`,
    `confidence: ${proposal.confidence}`,
    `requires_human_approval: ${proposal.requires_human_approval}`,
    '```',
    '',
    `### Summary`,
    proposal.summary || proposal.title,
    '',
    `### Evidence`,
    evidence,
    '',
    `### Expected Effect`,
    proposal.expected_effect || 'Not specified',
    '',
    `### Rollback Plan`,
    proposal.rollback_plan || 'Reject or close this proposal before it lands.',
  ].join('\n')
}

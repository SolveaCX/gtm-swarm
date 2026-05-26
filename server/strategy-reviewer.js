import { complete } from './llm.js'
import { normalizeProposal, proposalIssueTitle, renderProposalMarkdown } from './gtm-proposals.js'
import {
  getWorkspaceBySlug,
  getOrCreateGTMUser,
  createProposalIssue,
} from './multica-db.js'

export function buildStrategyReviewPrompt({
  project,
  metricsSummary = '',
  issueSummary = '',
  artifactSummary = '',
}) {
  return `You are the AI Strategy Reviewer for GTM Swarm project: ${project}.

Your job is to identify operational learnings and propose next actions.

METRICS SUMMARY:
${metricsSummary || 'No metrics supplied.'}

MULTICA ISSUE SUMMARY:
${issueSummary || 'No issue summary supplied.'}

ARTIFACT SUMMARY:
${artifactSummary || 'No artifact summary supplied.'}

Allowed proposal type values: execution_task, experiment_task, memory_update, sop_change.
Allowed target_scope values: project, global.
Allowed evidence kind values: metric, artifact, reviewer_note, note.
Allowed risk and confidence values: low, medium, high.

Return ONLY valid JSON. No markdown fences.
{
  "proposals": [
    {
      "type": "execution_task",
      "project": "${project}",
      "target_scope": "project",
      "target_agent_type": "",
      "target_file": "",
      "title": "",
      "summary": "",
      "evidence": [{ "kind": "metric", "reference": "" }],
      "risk": "medium",
      "confidence": "medium",
      "requires_human_approval": true,
      "expected_effect": "",
      "rollback_plan": ""
    }
  ]
}`
}

function stripJsonFences(text) {
  return String(text || '')
    .trim()
    .replace(/^```\s*(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim()
}

export function parseStrategyReviewResponse(text) {
  const clean = stripJsonFences(text)
  const parsed = JSON.parse(clean)
  const rows = Array.isArray(parsed?.proposals) ? parsed.proposals : []
  return rows.map(normalizeProposal)
}

export async function generateStrategyReviewProposals({
  project,
  metricsSummary = '',
  issueSummary = '',
  artifactSummary = '',
}) {
  const prompt = buildStrategyReviewPrompt({ project, metricsSummary, issueSummary, artifactSummary })
  const { text } = await complete(prompt, { maxTokens: 4000 })
  return parseStrategyReviewResponse(text)
}

export async function createStrategyReviewIssues({
  project,
  proposals,
}) {
  const workspace = await getWorkspaceBySlug(project)
  if (!workspace) throw new Error(`multica workspace not found: ${project}`)

  const botId = await getOrCreateGTMUser(workspace.id)
  const created = []
  for (const proposal of proposals.map(normalizeProposal)) {
    const issueId = await createProposalIssue(workspace.id, {
      title: proposalIssueTitle(proposal),
      description: renderProposalMarkdown(proposal),
      creatorId: botId,
      proposalType: proposal.type,
      priority: proposal.risk === 'high' ? 'high' : 'medium',
    })
    created.push({ issue_id: issueId, proposal })
  }
  return created
}

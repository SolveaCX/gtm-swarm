const MULTICA_BASE_URL = 'https://multica-ai.shulex.com'
const MULTICA_FILE_PREFIX = 'multica://'
const MULTICA_ISSUE_PREFIX = 'issue/'

export function multicaIssueUrl({ file, workspaceSlug }) {
  const issueId = multicaIssueId(file)
  if (!issueId || !workspaceSlug) return null
  return `${MULTICA_BASE_URL}/${encodeURIComponent(workspaceSlug)}/issues/${encodeURIComponent(issueId)}`
}

export function multicaIssueId(file) {
  if (!file || !file.startsWith(MULTICA_FILE_PREFIX)) return null
  const raw = file.slice(MULTICA_FILE_PREFIX.length)
  return raw.startsWith(MULTICA_ISSUE_PREFIX) ? raw.slice(MULTICA_ISSUE_PREFIX.length) : raw
}

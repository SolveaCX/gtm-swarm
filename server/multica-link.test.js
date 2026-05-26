import test from 'node:test'
import assert from 'node:assert/strict'
import { multicaIssueUrl } from '../lib/multica-links.js'

test('builds Multica issue URL from multica file reference', () => {
  assert.equal(
    multicaIssueUrl({
      file: 'multica://issue-123',
      workspaceSlug: 'gtm',
    }),
    'https://multica-ai.shulex.com/gtm/issues/issue-123',
  )
})

test('encodes workspace slug and issue id path segments', () => {
  assert.equal(
    multicaIssueUrl({
      file: 'multica://id with space',
      workspaceSlug: 'workspace cn',
    }),
    'https://multica-ai.shulex.com/workspace%20cn/issues/id%20with%20space',
  )
})

test('accepts namespaced multica issue references', () => {
  assert.equal(
    multicaIssueUrl({
      file: 'multica://issue/issue-123',
      workspaceSlug: 'gtm',
    }),
    'https://multica-ai.shulex.com/gtm/issues/issue-123',
  )
})

test('returns null for non-Multica references or missing workspace', () => {
  assert.equal(multicaIssueUrl({ file: 'projects/a.md', workspaceSlug: 'gtm' }), null)
  assert.equal(multicaIssueUrl({ file: 'multica://issue-123', workspaceSlug: '' }), null)
  assert.equal(multicaIssueUrl({ file: '', workspaceSlug: 'gtm' }), null)
})

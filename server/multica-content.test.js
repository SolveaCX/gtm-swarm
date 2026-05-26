import test from 'node:test'
import assert from 'node:assert/strict'

import {
  issueScopeForContentState,
  multicaStatusesForContentState,
  statusToContentState,
} from './multica-db.js'

test('maps draft and review tabs to distinct Multica statuses', () => {
  assert.deepEqual(multicaStatusesForContentState('draft'), ['in_progress'])
  assert.deepEqual(multicaStatusesForContentState('review'), ['in_review'])
  assert.deepEqual(multicaStatusesForContentState('bank'), ['done'])
})

test('only new ideas are restricted to top-level issues', () => {
  assert.equal(issueScopeForContentState('new-idea'), 'top_level')
  assert.equal(issueScopeForContentState('draft'), 'any')
  assert.equal(issueScopeForContentState('review'), 'any')
  assert.equal(issueScopeForContentState(undefined), 'any')
})

test('maps Multica issue statuses into content states', () => {
  assert.equal(statusToContentState('backlog'), 'new-idea')
  assert.equal(statusToContentState('in_progress'), 'draft')
  assert.equal(statusToContentState('in_review'), 'draft')
  assert.equal(statusToContentState('done'), 'bank')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { authorizeSwarmBearer, generateSwarmToken } from './swarm-token.js'

test('generates a strong swarm token', () => {
  const token = generateSwarmToken()
  assert.match(token, /^gtms_[a-f0-9]{64}$/)
})

test('authorizes with workspace token', () => {
  assert.equal(authorizeSwarmBearer({
    bearer: 'workspace-token',
    workspaceToken: 'workspace-token',
    globalToken: 'global-token',
  }), true)
})

test('authorizes with global admin token', () => {
  assert.equal(authorizeSwarmBearer({
    bearer: 'global-token',
    workspaceToken: 'workspace-token',
    globalToken: 'global-token',
  }), true)
})

test('rejects missing and mismatched tokens when a workspace token exists', () => {
  assert.equal(authorizeSwarmBearer({
    bearer: '',
    workspaceToken: 'workspace-token',
    globalToken: '',
  }), false)
  assert.equal(authorizeSwarmBearer({
    bearer: 'wrong',
    workspaceToken: 'workspace-token',
    globalToken: 'global-token',
  }), false)
})

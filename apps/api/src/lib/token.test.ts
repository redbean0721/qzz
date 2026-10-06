import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateDeleteToken, hashDeleteToken, verifyDeleteToken } from './token.js'

test('generateDeleteToken returns 43-char base64url', () => {
  assert.match(generateDeleteToken(), /^[A-Za-z0-9_-]{43}$/)
})

test('hashDeleteToken is deterministic sha256 hex', () => {
  const token = generateDeleteToken()
  const hash = hashDeleteToken(token)
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.equal(hashDeleteToken(token), hash)
})

test('verifyDeleteToken accepts the right token only', () => {
  const token = generateDeleteToken()
  const hash = hashDeleteToken(token)
  assert.equal(verifyDeleteToken(token, hash), true)
  assert.equal(verifyDeleteToken(generateDeleteToken(), hash), false)
  assert.equal(verifyDeleteToken(token, 'not-a-hash'), false)
})

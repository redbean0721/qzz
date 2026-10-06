import assert from 'node:assert/strict'
import { test } from 'node:test'
import { expiresAtFrom } from './expires.js'

const now = new Date('2026-01-01T00:00:00Z')

test('expiresAtFrom maps each option to a timestamp', () => {
  assert.equal(expiresAtFrom('1h', now)?.toISOString(), '2026-01-01T01:00:00.000Z')
  assert.equal(expiresAtFrom('1d', now)?.toISOString(), '2026-01-02T00:00:00.000Z')
  assert.equal(expiresAtFrom('7d', now)?.toISOString(), '2026-01-08T00:00:00.000Z')
  assert.equal(expiresAtFrom('30d', now)?.toISOString(), '2026-01-31T00:00:00.000Z')
})

test('expiresAtFrom returns null for never', () => {
  assert.equal(expiresAtFrom('never', now), null)
})

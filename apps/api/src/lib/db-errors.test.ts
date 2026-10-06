import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isUniqueViolation } from './db-errors.js'

function pgError(code: string, constraint?: string) {
  return Object.assign(new Error('pg error'), { code, constraint })
}

test('isUniqueViolation detects direct and wrapped 23505 errors', () => {
  assert.equal(isUniqueViolation(pgError('23505', 'links_code_unique')), true)
  assert.equal(
    isUniqueViolation(new Error('Failed query', { cause: pgError('23505', 'links_code_unique') })),
    true,
  )
})

test('isUniqueViolation filters by constraint name', () => {
  const err = pgError('23505', 'links_code_unique')
  assert.equal(isUniqueViolation(err, 'links_code_unique'), true)
  assert.equal(isUniqueViolation(err, 'pastes_code_unique'), false)
})

test('isUniqueViolation ignores other errors', () => {
  assert.equal(isUniqueViolation(pgError('23503')), false)
  assert.equal(isUniqueViolation(new Error('boom')), false)
  assert.equal(isUniqueViolation('23505'), false)
})

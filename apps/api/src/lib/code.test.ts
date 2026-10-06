import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CODE_LENGTH, generateCode } from './code.js'

test('generateCode returns base62 of default length', () => {
  for (let i = 0; i < 1000; i++) {
    assert.match(generateCode(), new RegExp(`^[0-9A-Za-z]{${CODE_LENGTH}}$`))
  }
})

test('generateCode respects custom length', () => {
  assert.equal(generateCode(6).length, 6)
})

test('generateCode does not repeat in a small sample', () => {
  const codes = new Set(Array.from({ length: 10_000 }, () => generateCode()))
  assert.equal(codes.size, 10_000)
})

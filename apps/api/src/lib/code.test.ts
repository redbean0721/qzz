import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CODE_LENGTH, generateCode, insertWithUniqueCode } from './code.js'

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

function uniqueViolation(constraint: string) {
  return new Error('Failed query', {
    cause: Object.assign(new Error('duplicate key'), { code: '23505', constraint }),
  })
}

test('insertWithUniqueCode retries on collision of the given constraint', async () => {
  const tried: string[] = []
  const collisions: number[] = []
  const code = await insertWithUniqueCode(
    'links_code_unique',
    async (code) => {
      tried.push(code)
      if (tried.length < 3) throw uniqueViolation('links_code_unique')
    },
    (_code, attempt) => collisions.push(attempt),
  )
  assert.equal(tried.length, 3)
  assert.equal(code, tried[2])
  assert.deepEqual(collisions, [1, 2])
})

test('insertWithUniqueCode rethrows other errors immediately', async () => {
  let calls = 0
  const err = uniqueViolation('some_other_unique')
  await assert.rejects(
    insertWithUniqueCode('links_code_unique', async () => {
      calls++
      throw err
    }),
    (e) => e === err,
  )
  assert.equal(calls, 1)
})

test('insertWithUniqueCode gives up after repeated collisions', async () => {
  let calls = 0
  await assert.rejects(
    insertWithUniqueCode('links_code_unique', async () => {
      calls++
      throw uniqueViolation('links_code_unique')
    }),
    /failed to allocate a unique short code/,
  )
  assert.equal(calls, 5)
})

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { buildApp } from './app.js'

let app: Awaited<ReturnType<typeof buildApp>>

before(async () => {
  app = await buildApp()
  app.get('/__boom', async () => {
    throw new Error('Failed query: select secret from users')
  })
})

after(async () => {
  await app.close()
})

test('5xx responses do not leak internal error messages', async () => {
  const res = await app.inject({ method: 'GET', url: '/__boom' })
  assert.equal(res.statusCode, 500)
  assert.deepEqual(res.json(), { error: 'internal server error' })
})

test('4xx errors from fastify keep their status and message', async () => {
  const badJson = await app.inject({
    method: 'POST',
    url: '/api/links',
    headers: { 'content-type': 'application/json' },
    payload: '{not json',
  })
  assert.equal(badJson.statusCode, 400)
  assert.match(badJson.json().message, /JSON/)

  const tooLarge = await app.inject({
    method: 'POST',
    url: '/api/links',
    payload: { url: `https://example.com/${'a'.repeat(2 * 1024 * 1024)}` },
  })
  assert.equal(tooLarge.statusCode, 413)
})

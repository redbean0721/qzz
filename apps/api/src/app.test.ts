import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { buildTestApp } from './testing.js'

let app: Awaited<ReturnType<typeof buildTestApp>>
// 接住 app 的 log，檢查哪些請求會被記錄
const logs: Array<{ level: number; msg: string }> = []

before(async () => {
  app = await buildTestApp({
    fastify: {
      logger: { level: 'info', stream: { write: (line: string) => void logs.push(JSON.parse(line)) } },
    },
  })
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
    url: '/v1/links',
    headers: { 'content-type': 'application/json' },
    payload: '{not json',
  })
  assert.equal(badJson.statusCode, 400)
  assert.match(badJson.json().message, /JSON/)

  const tooLarge = await app.inject({
    method: 'POST',
    url: '/v1/links',
    payload: { url: `https://example.com/${'a'.repeat(2 * 1024 * 1024)}` },
  })
  assert.equal(tooLarge.statusCode, 413)
})

test('/health requests are not logged, other routes are', async () => {
  logs.length = 0
  const health = await app.inject({ method: 'GET', url: '/health' })
  assert.equal(health.statusCode, 200)
  assert.equal(logs.length, 0)

  await app.inject({ method: 'GET', url: '/v1/links/xxxxxxx' })
  assert.ok(logs.some((l) => l.msg === 'incoming request'))
})

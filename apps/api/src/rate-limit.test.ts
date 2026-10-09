import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import type { LinkResponse, PasteResponse } from '@qzz/shared'
import type { AppOptions } from './app.js'
import { db, schema } from './db/index.js'
import { buildTestApp } from './testing.js'

type App = Awaited<ReturnType<typeof buildTestApp>>

const apps: App[] = []
const createdLinks: string[] = []
const createdPastes: string[] = []

// pool 是共用的，所有 app 都用完才一起關
after(async () => {
  if (createdLinks.length > 0) {
    await db.delete(schema.links).where(inArray(schema.links.code, createdLinks))
  }
  if (createdPastes.length > 0) {
    await db.delete(schema.pastes).where(inArray(schema.pastes.code, createdPastes))
  }
  await Promise.all(apps.map((app) => app.close()))
})

async function makeApp(opts: AppOptions) {
  const app = await buildTestApp(opts)
  apps.push(app)
  return app
}

async function postLink(app: App, inject: { remoteAddress?: string; headers?: Record<string, string> } = {}) {
  const res = await app.inject({ method: 'POST', url: '/v1/links', payload: { url: 'https://example.com' }, ...inject })
  if (res.statusCode === 201) createdLinks.push(res.json<LinkResponse>().code)
  return res
}

async function postPaste(app: App, remoteAddress: string) {
  const res = await app.inject({ method: 'POST', url: '/v1/pastes', payload: { content: 'x' }, remoteAddress })
  if (res.statusCode === 201) createdPastes.push(res.json<PasteResponse>().code)
  return res
}

test('create endpoints return 429 per IP once the limit is reached', async () => {
  const app = await makeApp({ rateLimit: { limits: { createPaste: 2 } } })

  assert.equal((await postPaste(app, '10.0.0.1')).statusCode, 201)
  assert.equal((await postPaste(app, '10.0.0.1')).statusCode, 201)

  const limited = await postPaste(app, '10.0.0.1')
  assert.equal(limited.statusCode, 429)
  assert.ok(Number(limited.headers['retry-after']) > 0)
  assert.equal(limited.json().statusCode, 429)

  // 其他 IP 不受影響
  assert.equal((await postPaste(app, '10.0.0.2')).statusCode, 201)
})

test('delete endpoints are limited even when the token is wrong', async () => {
  const app = await makeApp({ rateLimit: { limits: { delete: 2 } } })
  const del = () =>
    app.inject({
      method: 'DELETE',
      url: '/v1/links/abcdefg',
      headers: { authorization: 'Bearer guess' },
      remoteAddress: '10.0.0.3',
    })

  assert.equal((await del()).statusCode, 404)
  assert.equal((await del()).statusCode, 404)
  assert.equal((await del()).statusCode, 429)
})

test('reports are limited even when the target does not exist', async () => {
  const app = await makeApp({ rateLimit: { limits: { report: 2 } } })
  const post = () =>
    app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: { kind: 'link', code: 'abcdefg', reason: 'spam' },
      remoteAddress: '10.0.0.8',
    })

  assert.equal((await post()).statusCode, 404)
  assert.equal((await post()).statusCode, 404)
  assert.equal((await post()).statusCode, 429)
})

test('read endpoints are not rate limited', async () => {
  const app = await makeApp({ rateLimit: { limits: { createLink: 1, createPaste: 1, delete: 1 } } })
  const { code } = (await postPaste(app, '10.0.0.4')).json<PasteResponse>()

  for (let i = 0; i < 20; i++) {
    const res = await app.inject({ method: 'GET', url: `/v1/pastes/${code}`, remoteAddress: '10.0.0.4' })
    assert.equal(res.statusCode, 200)
  }
})

test('X-Forwarded-For is ignored without trustProxy', async () => {
  const app = await makeApp({ rateLimit: { limits: { createLink: 1 } } })
  const remoteAddress = '10.0.0.5'

  assert.equal((await postLink(app, { remoteAddress, headers: { 'x-forwarded-for': '198.51.100.1' } })).statusCode, 201)
  assert.equal((await postLink(app, { remoteAddress, headers: { 'x-forwarded-for': '198.51.100.2' } })).statusCode, 429)
})

test('with trustProxy, the client IP comes from X-Forwarded-For of trusted proxies only', async () => {
  const app = await makeApp({
    fastify: { trustProxy: '127.0.0.1' },
    rateLimit: { limits: { createLink: 1 } },
  })
  const viaProxy = (ip: string) =>
    postLink(app, { remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': ip } })

  assert.equal((await viaProxy('203.0.113.1')).statusCode, 201)
  assert.equal((await viaProxy('203.0.113.1')).statusCode, 429)

  const other = await viaProxy('203.0.113.2')
  assert.equal(other.statusCode, 201)
  const [row] = await db
    .select({ creatorIp: schema.links.creatorIp })
    .from(schema.links)
    .where(eq(schema.links.code, other.json<LinkResponse>().code))
  assert.equal(row?.creatorIp, '203.0.113.2')

  // 不在信任名單的來源偽造 X-Forwarded-For 沒有用
  const spoof = (ip: string) =>
    postLink(app, { remoteAddress: '10.0.0.6', headers: { 'x-forwarded-for': ip } })
  assert.equal((await spoof('192.0.2.1')).statusCode, 201)
  assert.equal((await spoof('192.0.2.2')).statusCode, 429)
})

test('requests are allowed when Valkey is unreachable (fail open)', async () => {
  const app = await makeApp({
    redisUrl: 'redis://127.0.0.1:1',
    rateLimit: { limits: { createLink: 1 } },
  })

  for (let i = 0; i < 3; i++) {
    assert.equal((await postLink(app, { remoteAddress: '10.0.0.7' })).statusCode, 201)
  }
})

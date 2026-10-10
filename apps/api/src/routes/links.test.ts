import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import type { LinkPreview, LinkResponse, LinkView } from '@qzz/shared'
import { buildTestApp } from '../testing.js'
import { db, schema } from '../db/index.js'
import { generateCode } from '../lib/code.js'
import { hashDeleteToken } from '../lib/token.js'

const { links } = schema
const created: string[] = []
let app: Awaited<ReturnType<typeof buildTestApp>>
let previewApp: Awaited<ReturnType<typeof buildTestApp>>

// 預覽用假的抓取函式：記錄被抓的網址，網址裡有 broken 就當成連線失敗
const previewCalls: string[] = []
const PREVIEW: LinkPreview = {
  title: 'Target',
  description: 'About the target',
  siteName: 'Example',
  image: 'https://example.com/og.png',
  youtube: null,
}

before(async () => {
  app = await buildTestApp()
  previewApp = await buildTestApp({
    linkPreview: {
      fetch: async (url) => {
        previewCalls.push(url)
        if (url.includes('broken')) throw new Error('connect ECONNREFUSED')
        return PREVIEW
      },
    },
  })
})

// pool 是共用的，兩個 app 都用完才一起關
after(async () => {
  if (created.length > 0) {
    await db.delete(links).where(inArray(links.code, created))
  }
  await Promise.all([app.close(), previewApp.close()])
})

async function createLink(payload: object) {
  const res = await app.inject({ method: 'POST', url: '/v1/links', payload })
  if (res.statusCode === 201) created.push(res.json<LinkResponse>().code)
  return res
}

test('POST /v1/links creates a link and stores only the token hash', async () => {
  const before = Date.now()
  const res = await createLink({ url: 'https://example.com/a?b=c' })
  assert.equal(res.statusCode, 201)

  const body = res.json<LinkResponse>()
  assert.match(body.code, /^[0-9A-Za-z]{7}$/)
  assert.equal(body.shortUrl, `${process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '')}/${body.code}`)
  assert.equal(body.url, 'https://example.com/a?b=c')
  // 沒指定 expiresIn 時預設 1 天
  const expiresAt = Date.parse(body.expiresAt!)
  assert.ok(expiresAt >= before + 86_400_000 && expiresAt <= Date.now() + 86_400_000)

  const [row] = await db.select().from(links).where(eq(links.code, body.code))
  assert.ok(row)
  assert.equal(row.deleteTokenHash, hashDeleteToken(body.deleteToken))
  assert.notEqual(row.deleteTokenHash, body.deleteToken)
})

test('POST /v1/links keeps expiresIn "never" permanent', async () => {
  const res = await createLink({ url: 'https://example.com/forever', expiresIn: 'never' })
  assert.equal(res.statusCode, 201)
  assert.equal(res.json<LinkResponse>().expiresAt, null)
})

test('POST /v1/links sets expiresAt from expiresIn', async () => {
  const before = Date.now()
  const res = await createLink({ url: 'https://example.com', expiresIn: '1h' })
  assert.equal(res.statusCode, 201)

  const expiresAt = Date.parse(res.json<LinkResponse>().expiresAt!)
  assert.ok(expiresAt >= before + 3600_000 && expiresAt <= Date.now() + 3600_000)
})

test('POST /v1/links rejects non-http(s) urls and control characters', async () => {
  for (const url of [
    'javascript:alert(1)',
    'ftp://example.com',
    'not a url',
    'https://example.com/a\u0000b',
    'https://example.com/a\u0001b',
  ]) {
    const res = await createLink({ url })
    assert.equal(res.statusCode, 400, url)
  }
})

test('POST /v1/links strips CR/LF and tabs like browsers do', async () => {
  const res = await createLink({ url: 'https://example.com/a\r\nSet-Cookie: x=1' })
  assert.equal(res.statusCode, 201)
  assert.equal(res.json<LinkResponse>().url, 'https://example.com/aSet-Cookie: x=1')
})

test('GET /v1/links/:code redirects with 302', async () => {
  const { code } = (await createLink({ url: 'https://example.com/target' })).json<LinkResponse>()

  const res = await app.inject({ method: 'GET', url: `/v1/links/${code}` })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, 'https://example.com/target')
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('GET /v1/links/:code returns 404 for unknown, expired and disabled links', async () => {
  const expired = generateCode()
  const disabled = generateCode()
  created.push(expired, disabled)
  await db.insert(links).values([
    { code: expired, url: 'https://example.com', deleteTokenHash: 'x', expiresAt: new Date(Date.now() - 1000) },
    { code: disabled, url: 'https://example.com', deleteTokenHash: 'x', disabled: true },
  ])

  for (const code of [generateCode(), expired, disabled, 'bad-code!']) {
    for (const url of [`/v1/links/${code}`, `/v1/links/${code}/info`]) {
      const res = await app.inject({ method: 'GET', url })
      assert.equal(res.statusCode, 404, url)
    }
  }
})

test('GET /v1/links/:code/info returns the target without redirecting', async () => {
  const created = (await createLink({ url: 'https://example.com/target?a=1', expiresIn: 'never' })).json<LinkResponse>()

  const res = await app.inject({ method: 'GET', url: `/v1/links/${created.code}/info` })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')

  const body = res.json<LinkView>()
  assert.deepEqual(Object.keys(body).sort(), ['code', 'createdAt', 'expiresAt', 'url'])
  assert.equal(body.code, created.code)
  assert.equal(body.url, 'https://example.com/target?a=1')
  assert.equal(body.expiresAt, null)
  assert.ok(Math.abs(Date.parse(body.createdAt) - Date.now()) < 60_000)
})

test('DELETE /v1/links/:code requires the right token', async () => {
  const { code, deleteToken } = (await createLink({ url: 'https://example.com' })).json<LinkResponse>()
  const del = (authorization?: string) =>
    app.inject({
      method: 'DELETE',
      url: `/v1/links/${code}`,
      headers: authorization ? { authorization } : {},
    })

  assert.equal((await del()).statusCode, 401)
  assert.equal((await del('Bearer wrong-token')).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: `/v1/links/${code}` })).statusCode, 302)

  assert.equal((await del(`Bearer ${deleteToken}`)).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: `/v1/links/${code}` })).statusCode, 404)
  assert.equal((await del(`Bearer ${deleteToken}`)).statusCode, 404)
})

test('GET /v1/links/:code/preview returns the target page preview and caches it', async () => {
  const target = `https://example.com/preview-${generateCode()}`
  const { code } = (await createLink({ url: target })).json<LinkResponse>()

  for (let i = 0; i < 2; i++) {
    const res = await previewApp.inject({ method: 'GET', url: `/v1/links/${code}/preview` })
    assert.equal(res.statusCode, 200)
    assert.equal(res.headers['cache-control'], 'no-store')
    assert.deepEqual(res.json<LinkPreview>(), PREVIEW)
  }
  // 第二次從 Valkey 拿
  assert.deepEqual(previewCalls, [target])

  // 抓失敗：回空的預覽（也會快取，不會每次都重抓）
  const broken = (await createLink({ url: `https://example.com/broken-${generateCode()}` })).json<LinkResponse>()
  for (let i = 0; i < 2; i++) {
    const res = await previewApp.inject({ method: 'GET', url: `/v1/links/${broken.code}/preview` })
    assert.deepEqual(res.json<LinkPreview>(), { title: null, description: null, siteName: null, image: null, youtube: null })
  }
  assert.equal(previewCalls.length, 2)

  assert.equal((await previewApp.inject({ method: 'GET', url: `/v1/links/${generateCode()}/preview` })).statusCode, 404)
})

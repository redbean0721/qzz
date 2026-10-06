import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import type { LinkResponse } from '@qzz/shared'
import { buildApp } from '../app.js'
import { db, schema } from '../db/index.js'
import { generateCode } from '../lib/code.js'
import { hashDeleteToken } from '../lib/token.js'

const { links } = schema
const created: string[] = []
let app: Awaited<ReturnType<typeof buildApp>>

before(async () => {
  app = await buildApp()
})

after(async () => {
  if (created.length > 0) {
    await db.delete(links).where(inArray(links.code, created))
  }
  await app.close()
})

async function createLink(payload: object) {
  const res = await app.inject({ method: 'POST', url: '/api/links', payload })
  if (res.statusCode === 201) created.push(res.json<LinkResponse>().code)
  return res
}

test('POST /api/links creates a link and stores only the token hash', async () => {
  const res = await createLink({ url: 'https://example.com/a?b=c' })
  assert.equal(res.statusCode, 201)

  const body = res.json<LinkResponse>()
  assert.match(body.code, /^[0-9A-Za-z]{7}$/)
  assert.equal(body.shortUrl, `${process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '')}/${body.code}`)
  assert.equal(body.url, 'https://example.com/a?b=c')
  assert.equal(body.expiresAt, null)

  const [row] = await db.select().from(links).where(eq(links.code, body.code))
  assert.ok(row)
  assert.equal(row.deleteTokenHash, hashDeleteToken(body.deleteToken))
  assert.notEqual(row.deleteTokenHash, body.deleteToken)
})

test('POST /api/links sets expiresAt from expiresIn', async () => {
  const before = Date.now()
  const res = await createLink({ url: 'https://example.com', expiresIn: '1h' })
  assert.equal(res.statusCode, 201)

  const expiresAt = Date.parse(res.json<LinkResponse>().expiresAt!)
  assert.ok(expiresAt >= before + 3600_000 && expiresAt <= Date.now() + 3600_000)
})

test('POST /api/links rejects non-http(s) urls and control characters', async () => {
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

test('POST /api/links strips CR/LF and tabs like browsers do', async () => {
  const res = await createLink({ url: 'https://example.com/a\r\nSet-Cookie: x=1' })
  assert.equal(res.statusCode, 201)
  assert.equal(res.json<LinkResponse>().url, 'https://example.com/aSet-Cookie: x=1')
})

test('GET /:code redirects with 302', async () => {
  const { code } = (await createLink({ url: 'https://example.com/target' })).json<LinkResponse>()

  const res = await app.inject({ method: 'GET', url: `/${code}` })
  assert.equal(res.statusCode, 302)
  assert.equal(res.headers.location, 'https://example.com/target')
  assert.equal(res.headers['cache-control'], 'no-store')
})

test('GET /:code returns 404 for unknown, expired and disabled links', async () => {
  const expired = generateCode()
  const disabled = generateCode()
  created.push(expired, disabled)
  await db.insert(links).values([
    { code: expired, url: 'https://example.com', deleteTokenHash: 'x', expiresAt: new Date(Date.now() - 1000) },
    { code: disabled, url: 'https://example.com', deleteTokenHash: 'x', disabled: true },
  ])

  for (const code of [generateCode(), expired, disabled, 'bad-code!']) {
    const res = await app.inject({ method: 'GET', url: `/${code}` })
    assert.equal(res.statusCode, 404, code)
  }
})

test('DELETE /api/links/:code requires the right token', async () => {
  const { code, deleteToken } = (await createLink({ url: 'https://example.com' })).json<LinkResponse>()
  const del = (authorization?: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/links/${code}`,
      headers: authorization ? { authorization } : {},
    })

  assert.equal((await del()).statusCode, 401)
  assert.equal((await del('Bearer wrong-token')).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: `/${code}` })).statusCode, 302)

  assert.equal((await del(`Bearer ${deleteToken}`)).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: `/${code}` })).statusCode, 404)
  assert.equal((await del(`Bearer ${deleteToken}`)).statusCode, 404)
})

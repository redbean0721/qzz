import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { MAX_PASTE_BYTES, type PasteResponse, type PasteView } from '@qzz/shared'
import { buildTestApp } from '../testing.js'
import { db, schema } from '../db/index.js'
import { generateCode } from '../lib/code.js'
import { hashDeleteToken } from '../lib/token.js'

const { pastes } = schema
const created: string[] = []
let app: Awaited<ReturnType<typeof buildTestApp>>

before(async () => {
  app = await buildTestApp()
})

after(async () => {
  if (created.length > 0) {
    await db.delete(pastes).where(inArray(pastes.code, created))
  }
  await app.close()
})

async function createPaste(payload: object) {
  const res = await app.inject({ method: 'POST', url: '/v1/pastes', payload })
  if (res.statusCode === 201) created.push(res.json<PasteResponse>().code)
  return res
}

test('POST /v1/pastes creates a paste with default 30d expiry', async () => {
  const before = Date.now()
  const res = await createPaste({ content: 'hello\nworld', language: 'text' })
  assert.equal(res.statusCode, 201)

  const body = res.json<PasteResponse>()
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '')
  assert.match(body.code, /^[0-9A-Za-z]{7}$/)
  assert.equal(body.url, `${base}/p/${body.code}`)
  assert.equal(body.rawUrl, `${base}/v1/pastes/${body.code}/raw`)

  const expiresAt = Date.parse(body.expiresAt!)
  const thirtyDays = 30 * 24 * 3600_000
  assert.ok(expiresAt >= before + thirtyDays && expiresAt <= Date.now() + thirtyDays)

  const [row] = await db.select().from(pastes).where(eq(pastes.code, body.code))
  assert.ok(row)
  assert.equal(row.deleteTokenHash, hashDeleteToken(body.deleteToken))
})

test('POST /v1/pastes enforces the byte limit', async () => {
  const exact = await createPaste({ content: 'a'.repeat(MAX_PASTE_BYTES) })
  assert.equal(exact.statusCode, 201)

  const over = await createPaste({ content: 'a'.repeat(MAX_PASTE_BYTES + 1) })
  assert.equal(over.statusCode, 400)

  // 3-byte UTF-8 字元：字數沒超過但 byte 數超過
  const multibyte = await createPaste({ content: '中'.repeat(Math.floor(MAX_PASTE_BYTES / 3) + 1) })
  assert.equal(multibyte.statusCode, 400)

  assert.equal((await createPaste({ content: '' })).statusCode, 400)
})

test('POST /v1/pastes rejects NUL characters', async () => {
  const res = await createPaste({ content: 'a\u0000b' })
  assert.equal(res.statusCode, 400)
})

test('POST /v1/pastes accepts max-size content that expands a lot as JSON', async () => {
  // 每個控制字元在 JSON 裡變成 \u0001（6 bytes），body 約 3 MB
  const res = await createPaste({ content: '\u0001'.repeat(MAX_PASTE_BYTES) })
  assert.equal(res.statusCode, 201)
})

test('GET /v1/pastes/:code returns the paste as JSON', async () => {
  const { code } = (await createPaste({ content: 'console.log(1)', language: 'js' })).json<PasteResponse>()

  const res = await app.inject({ method: 'GET', url: `/v1/pastes/${code}` })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')

  const body = res.json<PasteView>()
  assert.equal(body.code, code)
  assert.equal(body.content, 'console.log(1)')
  assert.equal(body.language, 'js')
  assert.ok(!Number.isNaN(Date.parse(body.createdAt)))
})

test('GET /v1/pastes/:code/raw serves untrusted content as plain text', async () => {
  const content = '<script>alert(1)</script>\n'
  const { code } = (await createPaste({ content })).json<PasteResponse>()

  const res = await app.inject({ method: 'GET', url: `/v1/pastes/${code}/raw` })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body, content)
  assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8')
  assert.equal(res.headers['x-content-type-options'], 'nosniff')
  assert.equal(res.headers['content-security-policy'], "default-src 'none'; sandbox")
})

test('GET returns 404 for unknown, expired and disabled pastes', async () => {
  const expired = generateCode()
  const disabled = generateCode()
  created.push(expired, disabled)
  await db.insert(pastes).values([
    { code: expired, content: 'x', deleteTokenHash: 'x', expiresAt: new Date(Date.now() - 1000) },
    { code: disabled, content: 'x', deleteTokenHash: 'x', disabled: true },
  ])

  for (const code of [generateCode(), expired, disabled, 'bad-code!']) {
    for (const url of [`/v1/pastes/${code}`, `/v1/pastes/${code}/raw`]) {
      const res = await app.inject({ method: 'GET', url })
      assert.equal(res.statusCode, 404, url)
    }
  }
})

test('DELETE /v1/pastes/:code requires the right token', async () => {
  const { code, deleteToken } = (await createPaste({ content: 'bye' })).json<PasteResponse>()
  const del = (authorization?: string) =>
    app.inject({
      method: 'DELETE',
      url: `/v1/pastes/${code}`,
      headers: authorization ? { authorization } : {},
    })

  assert.equal((await del()).statusCode, 401)
  assert.equal((await del('Bearer wrong-token')).statusCode, 404)
  assert.equal((await app.inject({ method: 'GET', url: `/v1/pastes/${code}` })).statusCode, 200)

  assert.equal((await del(`Bearer ${deleteToken}`)).statusCode, 204)
  assert.equal((await app.inject({ method: 'GET', url: `/v1/pastes/${code}` })).statusCode, 404)
  assert.equal((await del(`Bearer ${deleteToken}`)).statusCode, 404)
})

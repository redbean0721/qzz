import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { MAX_PASTE_BYTES, PASTE_LANGUAGES, type PasteLanguagesResponse, type PasteResponse, type PasteView } from '@qzz/shared'
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

test('POST /v1/pastes creates a paste with default 1d expiry', async () => {
  const before = Date.now()
  const res = await createPaste({ content: 'hello\nworld', language: 'text' })
  assert.equal(res.statusCode, 201)

  const body = res.json<PasteResponse>()
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, '')
  assert.match(body.code, /^[0-9A-Za-z]{7}$/)
  assert.equal(body.url, `${base}/p/${body.code}`)
  assert.equal(body.rawUrl, `${base}/v1/pastes/${body.code}/raw`)

  const expiresAt = Date.parse(body.expiresAt!)
  const oneDay = 24 * 3600_000
  assert.ok(expiresAt >= before + oneDay && expiresAt <= Date.now() + oneDay)

  const [row] = await db.select().from(pastes).where(eq(pastes.code, body.code))
  assert.ok(row)
  assert.equal(row.deleteTokenHash, hashDeleteToken(body.deleteToken))
})

test('POST /v1/pastes only accepts the supported languages', async () => {
  for (const language of PASTE_LANGUAGES) {
    assert.equal((await createPaste({ content: 'x', language })).statusCode, 201, language)
  }
  // 沒選語言也可以
  assert.equal((await createPaste({ content: 'x' })).statusCode, 201)

  for (const language of ['js', 'Python', '<script>', '', 'x'.repeat(33), 1]) {
    const res = await createPaste({ content: 'x', language })
    assert.equal(res.statusCode, 400, String(language))
    const [issue] = res.json<{ error: Array<{ path: string[]; message: string }> }>().error
    assert.deepEqual(issue?.path, ['language'])
  }
  const [issue] = (await createPaste({ content: 'x', language: 'js' })).json<{ error: Array<{ message: string }> }>().error
  assert.equal(issue?.message, '不支援這個語言')
})

test('GET /v1/pastes/languages lists the supported languages', async () => {
  const res = await app.inject({ method: 'GET', url: '/v1/pastes/languages' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'public, max-age=3600')
  assert.deepEqual(res.json<PasteLanguagesResponse>(), { languages: [...PASTE_LANGUAGES] })
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
  const { code } = (await createPaste({ content: 'console.log(1)', language: 'javascript' })).json<PasteResponse>()

  const res = await app.inject({ method: 'GET', url: `/v1/pastes/${code}` })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')

  const body = res.json<PasteView>()
  assert.equal(body.code, code)
  assert.equal(body.content, 'console.log(1)')
  assert.equal(body.language, 'javascript')
  assert.equal(body.description, 'console.log(1)')
  assert.equal(body.burnAfterReading, false)
  assert.ok(!Number.isNaN(Date.parse(body.createdAt)))
})

test('GET /v1/pastes/:code describes markdown pastes without markup', async () => {
  const content = '# 標題\n\n**粗體** 和 `code`，還有[連結](https://example.com)。\n\n- 項目\n'
  const { code } = (await createPaste({ content, language: 'markdown' })).json<PasteResponse>()

  const body = (await app.inject({ method: 'GET', url: `/v1/pastes/${code}` })).json<PasteView>()
  assert.equal(body.description, '標題 粗體 和 code，還有連結。 項目')
})

test('GET /v1/pastes/:code/og.png also renders markdown pastes', async () => {
  const content = '# 標題\n\n段落 **粗體** `code`\n\n```js\nconsole.log(1)\n```\n\n> 引言\n\n1. 一\n2. 二\n'
  const { code } = (await createPaste({ content, language: 'markdown' })).json<PasteResponse>()

  const res = await app.inject({ method: 'GET', url: `/v1/pastes/${code}/og.png` })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'image/png')
  assert.equal(res.rawPayload.readUInt32BE(16), 1200)
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
  assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow')
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
    for (const url of [`/v1/pastes/${code}`, `/v1/pastes/${code}/raw`, `/v1/pastes/${code}/og.png`]) {
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

test('GET /v1/pastes/:code/og.png renders a 1200x630 PNG', async () => {
  const { code } = (await createPaste({ content: 'const 中文 = "✅"\n'.repeat(20), language: 'typescript' })).json<PasteResponse>()

  const res = await app.inject({ method: 'GET', url: `/v1/pastes/${code}/og.png` })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'image/png')
  assert.equal(res.headers['cache-control'], 'public, max-age=600')
  assert.equal(res.headers['x-robots-tag'], 'noindex')

  const png = res.rawPayload
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  // IHDR：寬、高
  assert.equal(png.readUInt32BE(16), 1200)
  assert.equal(png.readUInt32BE(20), 630)

  // 第二次從記憶體快取拿，內容一樣
  const again = await app.inject({ method: 'GET', url: `/v1/pastes/${code}/og.png` })
  assert.ok(again.rawPayload.equals(png))

  // 下架後立刻 404，快取不會再送出舊圖
  await db.update(pastes).set({ disabled: true }).where(eq(pastes.code, code))
  const gone = await app.inject({ method: 'GET', url: `/v1/pastes/${code}/og.png` })
  assert.equal(gone.statusCode, 404)
  assert.equal(gone.headers['cache-control'], 'no-store')
})

const openPaste = (code: string) => app.inject({ method: 'POST', url: `/v1/pastes/${code}/open` })

test('burn-after-reading pastes hide their content until opened once', async () => {
  const content = '# secret\n\nonly once'
  const res = await createPaste({ content, language: 'markdown', burnAfterReading: true })
  assert.equal(res.statusCode, 201)
  const { code } = res.json<PasteResponse>()

  // 網址預覽、SSR 只拿得到基本資料
  const view = await app.inject({ method: 'GET', url: `/v1/pastes/${code}` })
  assert.equal(view.statusCode, 200)
  assert.deepEqual(
    { ...view.json<PasteView>(), createdAt: null, expiresAt: null },
    { code, content: null, language: 'markdown', description: '', burnAfterReading: true, createdAt: null, expiresAt: null },
  )
  for (const url of [`/v1/pastes/${code}/raw`, `/v1/pastes/${code}/og.png`]) {
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 404, url)
  }

  const opened = await openPaste(code)
  assert.equal(opened.statusCode, 200)
  assert.equal(opened.headers['cache-control'], 'no-store')
  const body = opened.json<PasteView>()
  assert.equal(body.content, content)
  assert.equal(body.description, 'secret only once')
  assert.equal(body.burnAfterReading, true)

  // 打開後整列刪除
  assert.equal((await db.select().from(pastes).where(eq(pastes.code, code))).length, 0)
  assert.equal((await app.inject({ method: 'GET', url: `/v1/pastes/${code}` })).statusCode, 404)
  assert.equal((await openPaste(code)).statusCode, 404)
})

test('a burn-after-reading paste opened twice at once is handed out only once', async () => {
  const { code } = (await createPaste({ content: 'race', burnAfterReading: true })).json<PasteResponse>()
  const results = await Promise.all(Array.from({ length: 5 }, () => openPaste(code)))
  assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 404, 404, 404, 404])
})

test('POST /v1/pastes/:code/open only opens active burn-after-reading pastes', async () => {
  const normal = (await createPaste({ content: 'keep me' })).json<PasteResponse>().code
  const expired = generateCode()
  const disabled = generateCode()
  created.push(expired, disabled)
  await db.insert(pastes).values([
    { code: expired, content: 'x', deleteTokenHash: 'x', burnAfterReading: true, expiresAt: new Date(Date.now() - 1000) },
    { code: disabled, content: 'x', deleteTokenHash: 'x', burnAfterReading: true, disabled: true },
  ])

  for (const code of [normal, expired, disabled, generateCode(), 'bad-code!']) {
    assert.equal((await openPaste(code)).statusCode, 404, code)
  }
  // 一般貼文不會被刪掉；過期、下架的留給清除和管理員
  const left = await db.select({ code: pastes.code }).from(pastes).where(inArray(pastes.code, [normal, expired, disabled]))
  assert.equal(left.length, 3)
})

test('a burn-after-reading paste can still be deleted with its token before it is opened', async () => {
  const { code, deleteToken } = (await createPaste({ content: 'oops', burnAfterReading: true })).json<PasteResponse>()
  const del = await app.inject({
    method: 'DELETE',
    url: `/v1/pastes/${code}`,
    headers: { authorization: `Bearer ${deleteToken}` },
  })
  assert.equal(del.statusCode, 204)
  assert.equal((await openPaste(code)).statusCode, 404)
})

test('burnAfterReading must be a boolean', async () => {
  for (const burnAfterReading of ['true', 1, null]) {
    assert.equal((await createPaste({ content: 'x', burnAfterReading })).statusCode, 400, String(burnAfterReading))
  }
})

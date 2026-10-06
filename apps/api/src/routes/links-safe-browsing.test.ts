import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import type { LinkResponse } from '@qzz/shared'
import { db, schema } from '../db/index.js'
import type { UrlVerdict } from '../lib/safe-browsing.js'
import { buildTestApp } from '../testing.js'

const { links } = schema
const created: string[] = []
const checked: string[] = []
// 每個測試自己設定假的 Safe Browsing 結果
let verdict: UrlVerdict = { status: 'safe' }
let app: Awaited<ReturnType<typeof buildTestApp>>

before(async () => {
  app = await buildTestApp({
    urlChecker: async (url) => {
      checked.push(url)
      return verdict
    },
  })
})

after(async () => {
  if (created.length > 0) {
    await db.delete(links).where(inArray(links.code, created))
  }
  await app.close()
})

async function createLink(url: string) {
  const res = await app.inject({ method: 'POST', url: '/v1/links', payload: { url } })
  if (res.statusCode === 201) created.push(res.json<LinkResponse>().code)
  return res
}

test('unsafe targets are rejected and not stored', async () => {
  verdict = { status: 'unsafe', threats: ['SOCIAL_ENGINEERING'] }
  const url = `https://evil.example/${Date.now()}`
  const res = await createLink(url)

  assert.equal(res.statusCode, 400)
  const body = res.json<{ error: Array<{ code: string; path: string[]; message: string }> }>()
  assert.equal(body.error[0]?.code, 'unsafe_url')
  assert.deepEqual(body.error[0]?.path, ['url'])
  assert.match(body.error[0]?.message ?? '', /危險網站/)

  const rows = await db.select({ code: links.code }).from(links).where(eq(links.url, url))
  assert.equal(rows.length, 0)
})

test('safe targets are created', async () => {
  verdict = { status: 'safe' }
  assert.equal((await createLink('https://example.com/safe')).statusCode, 201)
})

test('a failing check lets the link through (fail open)', async () => {
  verdict = { status: 'error', error: 'HTTP 503' }
  assert.equal((await createLink('https://example.com/while-google-is-down')).statusCode, 201)
})

test('the checker sees the validated URL, and invalid input never reaches it', async () => {
  verdict = { status: 'safe' }
  checked.length = 0
  await createLink('https://example.com/a\r\nb')
  await createLink('ftp://example.com')
  assert.deepEqual(checked, ['https://example.com/ab'])
})

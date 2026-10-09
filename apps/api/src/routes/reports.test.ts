import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { parseContentUrl } from '@qzz/shared'
import { db, schema } from '../db/index.js'
import { generateCode } from '../lib/code.js'
import { listReports, resolveReports } from '../lib/reports.js'
import { setDisabled } from '../lib/takedown.js'
import { buildTestApp } from '../testing.js'

const { links, pastes, reports } = schema

test('parseContentUrl accepts this site’s link and paste URLs', () => {
  const cases: Array<[string, ReturnType<typeof parseContentUrl>]> = [
    ['https://qzz.tw/abc1234', { kind: 'link', code: 'abc1234' }],
    ['  https://qzz.tw/abc1234/ ', { kind: 'link', code: 'abc1234' }],
    ['qzz.tw/abc1234', { kind: 'link', code: 'abc1234' }],
    ['http://QZZ.tw/abc1234?x=1#y', { kind: 'link', code: 'abc1234' }],
    ['https://qzz.tw/p/abc1234', { kind: 'paste', code: 'abc1234' }],
    ['https://qzz.tw/v1/pastes/abc1234/raw', { kind: 'paste', code: 'abc1234' }],
    ['https://qzz.tw/v1/pastes/abc1234', { kind: 'paste', code: 'abc1234' }],
    ['https://qzz.tw/v1/links/abc1234', { kind: 'link', code: 'abc1234' }],
  ]
  for (const [input, expected] of cases) {
    assert.deepEqual(parseContentUrl(input, 'qzz.tw'), expected, input)
  }
})

test('parseContentUrl rejects other sites and paths', () => {
  for (const input of [
    '',
    'abc1234',
    'https://example.com/abc1234',
    'https://qzz.tw.evil.com/abc1234',
    'https://qzz.tw/',
    'https://qzz.tw/a/b',
    'https://qzz.tw/p/abc1234/raw',
    'https://qzz.tw/bad-code',
    'https://qzz.tw/' + 'a'.repeat(17),
    'ftp://qzz.tw/abc1234',
    'javascript://qzz.tw/abc1234',
  ]) {
    assert.equal(parseContentUrl(input, 'qzz.tw'), null, input)
  }
  assert.deepEqual(parseContentUrl('localhost:3000/p/abc1234', 'localhost:3000'), { kind: 'paste', code: 'abc1234' })
})

const linkCode = generateCode()
const pasteCode = generateCode()
const expiredCode = generateCode()
let app: Awaited<ReturnType<typeof buildTestApp>>

before(async () => {
  app = await buildTestApp()
  await db.insert(links).values([
    { code: linkCode, url: 'https://example.com/phish', deleteTokenHash: 'x' },
    { code: expiredCode, url: 'https://example.com/old', deleteTokenHash: 'x', expiresAt: new Date(Date.now() - 1000) },
  ])
  await db.insert(pastes).values({ code: pasteCode, content: 'spam spam', deleteTokenHash: 'x' })
})

// 刪掉對象時檢舉會跟著 cascade 刪除
after(async () => {
  await db.delete(links).where(inArray(links.code, [linkCode, expiredCode]))
  await db.delete(pastes).where(inArray(pastes.code, [pasteCode]))
  await app.close()
})

function report(payload: object, remoteAddress = '10.1.0.1') {
  return app.inject({ method: 'POST', url: '/v1/reports', payload, remoteAddress })
}

async function reportsFor(kind: 'link' | 'paste', code: string) {
  const table = kind === 'link' ? links : pastes
  const column = kind === 'link' ? reports.linkId : reports.pasteId
  return db
    .select({ reason: reports.reason, details: reports.details, reporterIp: reports.reporterIp, resolvedAt: reports.resolvedAt })
    .from(reports)
    .innerJoin(table, eq(column, table.id))
    .where(eq(table.code, code))
    .orderBy(reports.id)
}

test('POST /v1/reports records a report once per IP until it is resolved', async () => {
  const payload = { kind: 'link', code: linkCode, reason: 'phishing', details: '  假冒銀行登入頁  ' }
  assert.equal((await report(payload)).statusCode, 204)
  // 同一個 IP 再檢舉：回應一樣，但不重複記錄
  assert.equal((await report({ ...payload, reason: 'spam' })).statusCode, 204)
  assert.equal((await report(payload, '10.1.0.2')).statusCode, 204)

  let rows = await reportsFor('link', linkCode)
  assert.deepEqual(
    rows.map((r) => [r.reason, r.details, r.reporterIp]),
    [
      ['phishing', '假冒銀行登入頁', '10.1.0.1'],
      ['phishing', '假冒銀行登入頁', '10.1.0.2'],
    ],
  )

  const open = (await listReports()).find((g) => g.code === linkCode)
  assert.equal(open?.kind, 'link')
  assert.equal(open?.reports, 2)
  assert.equal(open?.open, 2)
  assert.deepEqual(open?.reasons, ['phishing'])
  assert.equal(open?.target, 'https://example.com/phish')

  assert.equal(await resolveReports({ kind: 'link', code: linkCode }), 2)
  assert.equal(await resolveReports({ kind: 'link', code: linkCode }), 0)
  assert.equal((await listReports()).find((g) => g.code === linkCode), undefined)
  assert.equal((await listReports({ all: true })).find((g) => g.code === linkCode)?.open, 0)

  // 處理完之後同一個 IP 可以再檢舉
  assert.equal((await report(payload)).statusCode, 204)
  rows = await reportsFor('link', linkCode)
  assert.equal(rows.length, 3)
  assert.equal(rows.filter((r) => r.resolvedAt === null).length, 1)
})

test('POST /v1/reports works for pastes and stores empty details as null', async () => {
  assert.equal((await report({ kind: 'paste', code: pasteCode, reason: 'spam', details: '   ' })).statusCode, 204)
  const [row] = await reportsFor('paste', pasteCode)
  assert.equal(row?.details, null)
  assert.equal((await listReports()).find((g) => g.code === pasteCode)?.target, 'spam spam')
})

test('POST /v1/reports skips content that is already taken down', async () => {
  const code = generateCode()
  await db.insert(pastes).values({ code, content: 'gone', deleteTokenHash: 'x', disabled: true })
  try {
    assert.equal((await report({ kind: 'paste', code, reason: 'illegal' })).statusCode, 204)
    assert.equal((await reportsFor('paste', code)).length, 0)
  } finally {
    await db.delete(pastes).where(eq(pastes.code, code))
  }
})

test('POST /v1/reports returns 404 for missing or expired content', async () => {
  assert.equal((await report({ kind: 'link', code: generateCode(), reason: 'spam' })).statusCode, 404)
  assert.equal((await report({ kind: 'link', code: expiredCode, reason: 'spam' })).statusCode, 404)
  // 短網址和貼文是不同的命名空間
  assert.equal((await report({ kind: 'paste', code: linkCode, reason: 'spam' })).statusCode, 404)
})

test('POST /v1/reports validates the body', async () => {
  for (const payload of [
    {},
    { kind: 'link', code: linkCode },
    { kind: 'link', code: linkCode, reason: 'boring' },
    { kind: 'file', code: linkCode, reason: 'spam' },
    { kind: 'link', code: 'bad-code!', reason: 'spam' },
    { kind: 'link', code: linkCode, reason: 'other', details: 'x'.repeat(1001) },
    { kind: 'link', code: linkCode, reason: 'other', details: 'a\u0000b' },
  ]) {
    assert.equal((await report(payload)).statusCode, 400, JSON.stringify(payload).slice(0, 80))
  }
  // 換行可以
  assert.equal((await report({ kind: 'link', code: linkCode, reason: 'other', details: 'a\nb' }, '10.1.0.9')).statusCode, 204)
})

test('admin disable resolves open reports through resolveReports', async () => {
  await report({ kind: 'paste', code: pasteCode, reason: 'spam' }, '10.1.0.3')
  assert.equal(await setDisabled({ kind: 'paste', code: pasteCode }, true), true)
  assert.ok((await resolveReports({ kind: 'paste', code: pasteCode })) >= 1)
  assert.equal((await listReports()).find((g) => g.code === pasteCode), undefined)
})

test('deleting the content deletes its reports', async () => {
  const code = generateCode()
  await db.insert(links).values({ code, url: 'https://example.com/x', deleteTokenHash: 'x' })
  await report({ kind: 'link', code, reason: 'malware' })
  assert.equal((await reportsFor('link', code)).length, 1)
  const [{ id }] = (await db.delete(links).where(eq(links.code, code)).returning({ id: links.id })) as [{ id: number }]
  assert.equal((await db.select().from(reports).where(eq(reports.linkId, id))).length, 0)
})

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, test } from 'node:test'
import Fastify from 'fastify'
import { eq, inArray } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { REDIS_URL } from '../config.js'
import { db, pool, schema } from '../db/index.js'
import { generateCode } from '../lib/code.js'
import type { BatchChecker, UrlVerdict } from '../lib/safe-browsing.js'
import { recheckLinks, startRecheckScheduler } from './safe-browsing-recheck.js'

const { links, reports } = schema
const redis = new Redis(REDIS_URL)
const run = randomUUID()
// 每個測試連結有自己的網址；假的檢查只回答這些，其他 dev 資料回 error（不會被更新）
const url = (name: string) => `https://${name}.${run}.example/`
const hours = (n: number) => new Date(Date.now() - n * 3_600_000)

type Row = typeof links.$inferInsert
const rows: Record<string, Partial<Row>> = {
  fresh: {}, // 沒檢查過 → 到期
  checkedNow: { checkedAt: new Date() },
  newChecked2h: { createdAt: hours(3), checkedAt: hours(2) }, // 1 天內，每小時 → 到期
  oldChecked2h: { createdAt: hours(72), checkedAt: hours(2) }, // 7 天內，每 6 小時 → 還沒
  oldChecked7h: { createdAt: hours(72), checkedAt: hours(7) }, // → 到期
  ancientChecked7h: { createdAt: hours(24 * 30), checkedAt: hours(7) }, // 之後每天 → 還沒
  phishing: {},
  phishingTwin: {}, // 同一個網址的另一個短網址
  disabled: { disabled: true },
  expired: { expiresAt: hours(1) },
  reenabled: { safeBrowsingThreats: ['SOCIAL_ENGINEERING'] }, // 管理員恢復過
}
const codes = Object.fromEntries(Object.keys(rows).map((name) => [name, generateCode()]))
const urlOf = (name: string) => url(name === 'phishingTwin' ? 'phishing' : name)

const asked: string[][] = []
const fakeCheck: BatchChecker = async (urls) => {
  asked.push(urls)
  const verdicts = new Map<string, UrlVerdict>()
  for (const u of urls) {
    if (u === url('phishing')) verdicts.set(u, { status: 'unsafe', threats: ['SOCIAL_ENGINEERING'] })
    else if (u.includes(run)) verdicts.set(u, { status: 'safe' })
    else verdicts.set(u, { status: 'error', error: 'not part of this test' })
  }
  return verdicts
}

before(async () => {
  await db.insert(links).values(
    Object.entries(rows).map(([name, row]) => ({ code: codes[name]!, url: urlOf(name), deleteTokenHash: 'x', ...row })),
  )
  const [phishing] = await db.select({ id: links.id }).from(links).where(eq(links.code, codes.phishing!))
  await db.insert(reports).values({ linkId: phishing!.id, reason: 'phishing', reporterIp: '192.0.2.1' })
})

after(async () => {
  await db.delete(links).where(inArray(links.code, Object.values(codes)))
  redis.disconnect()
  await pool.end()
})

const ours = (urls: string[]) => urls.filter((u) => u.includes(run)).sort()
const state = async (name: string) => {
  const [row] = await db
    .select({ disabled: links.disabled, threats: links.safeBrowsingThreats, checkedAt: links.checkedAt })
    .from(links)
    .where(eq(links.code, codes[name]!))
  return row!
}

test('recheckLinks checks due links and disables the flagged ones', async () => {
  const started = Date.now()
  const result = await recheckLinks(fakeCheck, { limit: 100_000 })

  // 到期的才查；已下架、過期、管理員恢復過的不查
  assert.deepEqual(ours(asked.flat()), ['fresh', 'newChecked2h', 'oldChecked7h', 'phishing'].map(url).sort())
  assert.deepEqual(
    result.disabled.map((link) => link.code).sort(),
    [codes.phishing, codes.phishingTwin].sort(),
  )

  for (const name of ['phishing', 'phishingTwin']) {
    const row = await state(name)
    assert.equal(row.disabled, true, name)
    assert.deepEqual(row.threats, ['SOCIAL_ENGINEERING'], name)
  }
  for (const name of ['fresh', 'newChecked2h', 'oldChecked7h']) {
    const row = await state(name)
    assert.equal(row.disabled, false, name)
    assert.ok(row.checkedAt && row.checkedAt.getTime() >= started - 1000, name)
  }
  assert.ok((await state('oldChecked2h')).checkedAt!.getTime() < started - 3_600_000)

  // 下架時它的檢舉一起處理
  const [report] = await db
    .select({ resolvedAt: reports.resolvedAt })
    .from(reports)
    .innerJoin(links, eq(reports.linkId, links.id))
    .where(eq(links.code, codes.phishing!))
  assert.ok(report?.resolvedAt)

  // 管理員恢復過的不會被重新下架
  assert.equal((await state('reenabled')).disabled, false)
})

test('a second run has nothing of ours left to check', async () => {
  asked.length = 0
  const result = await recheckLinks(fakeCheck, { limit: 100_000 })
  assert.deepEqual(ours(asked.flat()), [])
  assert.equal(result.disabled.length, 0)
})

test('failed lookups are left for the next run', async () => {
  const code = generateCode()
  await db.insert(links).values({ code, url: url('flaky'), deleteTokenHash: 'x' })
  try {
    const failing: BatchChecker = async (urls) =>
      new Map(urls.map((u) => [u, { status: 'error', error: 'HTTP 503' } satisfies UrlVerdict]))
    const result = await recheckLinks(failing, { limit: 100_000 })
    assert.ok(result.failed >= 1)
    assert.equal(result.error, 'HTTP 503')
    const [row] = await db.select({ checkedAt: links.checkedAt, disabled: links.disabled }).from(links).where(eq(links.code, code))
    assert.deepEqual(row, { checkedAt: null, disabled: false })
  } finally {
    await db.delete(links).where(eq(links.code, code))
  }
})

test('scheduler runs on start under a lock and logs takedowns', async () => {
  const code = generateCode()
  await db.insert(links).values({ code, url: url('phishing'), deleteTokenHash: 'x' })
  const warnings: unknown[] = []
  const log = Fastify().log
  log.warn = ((obj: unknown) => warnings.push(obj)) as typeof log.warn
  try {
    const stop = startRecheckScheduler({
      redis,
      log,
      check: fakeCheck,
      intervalMs: 3_600_000,
      lockKey: `qzz:test:lock:${randomUUID()}`,
    })
    await stop()
    assert.ok(warnings.some((w) => (w as { code?: string }).code === code))
    assert.equal((await db.select({ disabled: links.disabled }).from(links).where(eq(links.code, code)))[0]?.disabled, true)
  } finally {
    await db.delete(links).where(eq(links.code, code))
  }
})

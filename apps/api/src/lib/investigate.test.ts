import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { after, before, test } from 'node:test'
import { eq, inArray } from 'drizzle-orm'
import { db, pool, schema } from '../db/index.js'
import { generateCode } from './code.js'
import {
  disableByIp,
  formatContentRow,
  listByIp,
  listRecent,
  parseDuration,
  parseIpFilter,
  printable,
  topIps,
  type ContentRow,
} from './investigate.js'

test('parseIpFilter accepts addresses and small enough ranges', () => {
  const cases: Array<[string, string | null]> = [
    ['203.0.113.7', '203.0.113.7'],
    [' 2001:db8::1 ', '2001:db8::1'],
    ['203.0.113.0/24', '203.0.113.0/24'],
    ['203.0.0.0/16', '203.0.0.0/16'],
    ['2001:db8:1:2::/64', '2001:db8:1:2::/64'],
    ['2001:db8::/32', '2001:db8::/32'],
    ['203.0.0.0/15', null], // 太大
    ['::/0', null],
    ['0.0.0.0/0', null],
    ['203.0.113.7/33', null],
    ['203.0.113.7/24/1', null],
    ['203.0.113.7/x', null],
    ['203.0.113', null],
    ['example.com', null],
    ["1.2.3.4'; drop table links; --", null],
    ['', null],
  ]
  for (const [input, expected] of cases) assert.equal(parseIpFilter(input), expected, input)
})

test('parseDuration reads m / h / d', () => {
  assert.equal(parseDuration('30m'), 30 * 60_000)
  assert.equal(parseDuration('24h'), 86_400_000)
  assert.equal(parseDuration('7d'), 7 * 86_400_000)
  for (const input of ['0h', '1w', '24', 'h', '-1h', '1.5h', '99999d']) assert.equal(parseDuration(input), null, input)
})

test('printable keeps user content from controlling the terminal', () => {
  const esc = String.fromCodePoint(0x1b)
  const rlo = String.fromCodePoint(0x202e)
  const lineSeparator = String.fromCodePoint(0x2028)
  assert.equal(printable(`${esc}[2J${esc}]0;title\u0007hi`), '\\u{1b}[2J\\u{1b}]0;title\\u{7}hi')
  assert.equal(printable(`https://example.com/${rlo}gpj.exe`), 'https://example.com/\\u{202e}gpj.exe')
  assert.equal(printable(`a\r\n\tb${lineSeparator}c`), 'a b\\u{2028}c')
  assert.equal(printable('中文字'.repeat(10), 5), '中文字中文…')
})

test('formatContentRow shows one line per item', () => {
  const at = new Date('2026-10-14T07:18:36.779Z')
  const link: ContentRow = {
    kind: 'link', code: 'Ab3dE9k', summary: 'https://example.com/x', language: null, bytes: null,
    disabled: true, expired: false, creatorIp: '203.0.113.7', createdAt: at,
  }
  assert.equal(
    formatContentRow(link),
    'link   Ab3dE9k  2026-10-14T07:18:36Z  203.0.113.7      [disabled]  https://example.com/x',
  )
  const paste: ContentRow = {
    kind: 'paste', code: 'Qz7xK2p', summary: 'line 1\nline 2', language: 'python', bytes: 2048,
    disabled: false, expired: true, creatorIp: null, createdAt: at,
  }
  assert.equal(formatContentRow(paste), 'paste  Qz7xK2p  2026-10-14T07:18:36Z  -                [expired]  python 2.0 KB  "line 1 line 2"')
})

// 每次執行用不同的位址，不會跟其他測試或舊資料混在一起
// 兩個 IPv6 位址在同一個 /48、不同的 /64（4 位數，網段的文字表示才不會被縮寫）
const net48 = `2001:db8:${randomInt(0x1000, 0x10000).toString(16)}`
const ip6a = `${net48}:1::a`
const ip6b = `${net48}:2::b`
const ip4 = `198.18.${randomInt(256)}.${randomInt(256)}`
const code = { a: generateCode(), b: generateCode(), d: generateCode(), paste: generateCode() }
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000)

before(async () => {
  const [a] = await db
    .insert(schema.links)
    .values([
      { code: code.a, url: 'https://example.com/a', deleteTokenHash: 'x', creatorIp: ip6a, createdAt: ago(40) },
      { code: code.b, url: 'https://example.com/b', deleteTokenHash: 'x', creatorIp: ip6b, createdAt: ago(30), expiresAt: ago(1) },
      { code: code.d, url: 'https://example.com/d', deleteTokenHash: 'x', creatorIp: ip6a, createdAt: ago(20), disabled: true },
    ])
    .returning({ id: schema.links.id })
  await db.insert(schema.pastes).values({
    code: code.paste, content: 'print("hi")\n'.repeat(10), language: 'python', deleteTokenHash: 'x', creatorIp: ip4, createdAt: ago(10),
  })
  await db.insert(schema.reports).values({ linkId: a!.id, reason: 'phishing', reporterIp: '192.0.2.1' })
})

after(async () => {
  await db.delete(schema.links).where(inArray(schema.links.code, [code.a, code.b, code.d]))
  await db.delete(schema.pastes).where(eq(schema.pastes.code, code.paste))
  await pool.end()
})

const codes = (rows: ContentRow[]) => rows.map((row) => row.code)

test('listByIp finds content by address or range, newest first', async () => {
  assert.deepEqual(codes(await listByIp(ip6a)), [code.d, code.a])
  assert.deepEqual(codes(await listByIp(`${net48}:1::/64`)), [code.d, code.a])
  assert.deepEqual(codes(await listByIp(`${net48}::/48`)), [code.d, code.b, code.a])
  assert.deepEqual(codes(await listByIp(`${net48}::/48`, { kind: 'paste' })), [])
  assert.deepEqual(codes(await listByIp(ip4)), [code.paste])
})

test('listRecent includes every kind with its state', async () => {
  const rows = await listRecent({ sinceMs: 3_600_000, limit: 1000 })
  const mine = rows.filter((row) => Object.values(code).includes(row.code))
  assert.deepEqual(codes(mine), [code.paste, code.d, code.b, code.a])
  const [paste, d, b] = mine
  assert.deepEqual(
    { kind: paste!.kind, language: paste!.language, bytes: paste!.bytes, ip: paste!.creatorIp },
    { kind: 'paste', language: 'python', bytes: 120, ip: ip4 },
  )
  assert.equal(paste!.summary.length, 80)
  assert.equal(d!.disabled, true)
  assert.equal(b!.expired, true)

  const pastesOnly = await listRecent({ kind: 'paste', sinceMs: 3_600_000, limit: 1000 })
  assert.ok(pastesOnly.every((row) => row.kind === 'paste'))
  assert.equal((await listRecent({ limit: 2 })).length, 2)
})

test('topIps groups IPv4 by /24 and IPv6 by /48 by default', async () => {
  const find = (rows: Awaited<ReturnType<typeof topIps>>, network: string) => {
    const row = rows.find((r) => r.network === network)
    return row && { addresses: row.addresses, links: row.links, pastes: row.pastes, disabled: row.disabled }
  }
  const ip4net = `${ip4.split('.').slice(0, 3).join('.')}.0/24`

  const grouped = await topIps({ sinceMs: 3_600_000, limit: 1000 })
  assert.deepEqual(find(grouped, `${net48}::/48`), { addresses: 2, links: 3, pastes: 0, disabled: 1 })
  assert.deepEqual(find(grouped, ip4net), { addresses: 1, links: 0, pastes: 1, disabled: 0 })

  // 改成更小的網段：/64 只有 ip6a 那兩筆；IPv4 /32 就是單一位址
  const narrow = await topIps({ sinceMs: 3_600_000, limit: 1000, v4: 32, v6: 64 })
  assert.deepEqual(find(narrow, `${net48}:1::/64`), { addresses: 1, links: 2, pastes: 0, disabled: 1 })
  assert.deepEqual(find(narrow, `${ip4}/32`), { addresses: 1, links: 0, pastes: 1, disabled: 0 })

  await assert.rejects(topIps({ sinceMs: 3_600_000, v4: 8 }), RangeError)
  await assert.rejects(topIps({ sinceMs: 3_600_000, v6: 16 }), RangeError)
})

test('disableByIp takes down what is still online and resolves its reports', async () => {
  const result = await disableByIp(`${net48}::/48`)
  assert.deepEqual(result.links.sort(), [code.a, code.b].sort())
  assert.deepEqual(result.pastes, [])
  assert.equal(result.reportsResolved, 1)

  const rows = await listByIp(`${net48}::/48`)
  assert.ok(rows.every((row) => row.disabled))
  const [report] = await db
    .select({ resolvedAt: schema.reports.resolvedAt })
    .from(schema.reports)
    .innerJoin(schema.links, eq(schema.reports.linkId, schema.links.id))
    .where(eq(schema.links.code, code.a))
  assert.ok(report?.resolvedAt)

  // 再跑一次：沒有東西可以下架；其他 IP 的內容不受影響
  assert.deepEqual(await disableByIp(`${net48}::/48`), { links: [], pastes: [], reportsResolved: 0 })
  assert.equal((await listByIp(ip4))[0]?.disabled, false)
})

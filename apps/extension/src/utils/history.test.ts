import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  REMOVAL_TTL_MS,
  mergeHistory,
  parseHistoryItems,
  parseHistoryRemovals,
  removalOf,
  sameHistory,
  type HistoryState,
} from '@qzz/shared'
import { MAX_HISTORY_ITEMS, withAdded, withRemoved, type HistoryItem } from './history'

// 合併規則在 @qzz/shared（網站和擴充功能共用），shared 沒有測試設定，所以測在這裡

const now = Date.parse('2026-10-15T00:00:00Z')
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()
const item = (code: string, opts: Partial<HistoryItem> = {}): HistoryItem => ({
  kind: 'link',
  code,
  url: `https://qzz.tw/${code}`,
  deleteToken: 'tok_en-123',
  expiresAt: null,
  createdAt: at(-1),
  ...opts,
})
const state = (items: HistoryItem[], removed: HistoryState['removed'] = []): HistoryState => ({ items, removed })
const codes = (s: HistoryState) => s.items.map((i) => `${i.kind}:${i.code}`)

test('mergeHistory takes the union, newest first, without duplicates', () => {
  const web = state([item('web', { createdAt: at(-1) }), item('both', { createdAt: at(-5) })])
  const ext = state([item('both', { createdAt: at(-5) }), item('ext', { createdAt: at(-3) }), item('ext', { kind: 'paste', createdAt: at(-2) })])
  assert.deepEqual(codes(mergeHistory([web, ext], now)), ['link:web', 'paste:ext', 'link:ext', 'link:both'])
})

test('mergeHistory gives the same result in any order and when repeated', () => {
  const web = state([item('a', { createdAt: at(-1) }), item('b', { createdAt: at(-2) })], [removalOf(item('gone'), now)])
  const ext = state([item('b', { createdAt: at(-2) }), item('gone'), item('c', { createdAt: at(-3) })])
  const once = mergeHistory([web, ext], now)
  assert.ok(sameHistory(once, mergeHistory([ext, web], now)))
  assert.ok(sameHistory(once, mergeHistory([once], now)))
  assert.ok(sameHistory(once, mergeHistory([once, web, ext], now)))
})

test('a removal on one side removes the item from the other side and is kept', () => {
  const doomed = item('doomed')
  const web = state([item('keep')], [removalOf(doomed, now)])
  const ext = state([doomed, item('keep')])
  const merged = mergeHistory([web, ext], now)
  assert.deepEqual(codes(merged), ['link:keep'])
  assert.equal(merged.removed.length, 1)
  // 擴充功能拿到合併結果後，下次再跟還有它的舊資料合併也不會回來
  assert.deepEqual(codes(mergeHistory([merged, ext], now)), ['link:keep'])
})

test('a removal only matches the same item, not a new item that got the same code', () => {
  const old = item('reuse', { createdAt: at(-60) })
  const fresh = item('reuse', { createdAt: at(-1) })
  assert.deepEqual(codes(mergeHistory([state([fresh], [removalOf(old, now)])], now)), ['link:reuse'])
})

test('expired items and expired removals are dropped', () => {
  const merged = mergeHistory(
    [
      state(
        [item('past', { expiresAt: at(-1) }), item('exact', { expiresAt: at(0) }), item('future', { expiresAt: at(1) })],
        [{ kind: 'link', code: 'old', createdAt: at(-100), until: at(-1) }],
      ),
    ],
    now,
  )
  assert.deepEqual(codes(merged), ['link:future'])
  assert.deepEqual(merged.removed, [])
})

test('removals are kept until the item would have expired, at most 30 days for permanent items', () => {
  assert.equal(removalOf(item('a', { expiresAt: at(60) }), now).until, at(60))
  assert.equal(removalOf(item('b'), now).until, new Date(now + REMOVAL_TTL_MS).toISOString())
})

test('mergeHistory keeps at most MAX_HISTORY_ITEMS, dropping the oldest', () => {
  const many = Array.from({ length: MAX_HISTORY_ITEMS + 5 }, (_, n) => item(`c${n}`, { createdAt: at(-n) }))
  const merged = mergeHistory([state(many.slice(0, 60)), state(many.slice(60))], now)
  assert.equal(merged.items.length, MAX_HISTORY_ITEMS)
  assert.equal(merged.items.at(-1)!.code, `c${MAX_HISTORY_ITEMS - 1}`)
})

test('parseHistoryItems drops malformed items and, with an origin, foreign URLs', () => {
  const good = item('good')
  const raw: unknown[] = [
    good,
    { ...item('js'), url: 'javascript:alert(1)' },
    { ...item('token'), deleteToken: 'has space' },
    { ...item('code'), code: '<script>' },
    { ...item('date'), createdAt: 'yesterday' },
    { ...item('kind'), kind: 'file' },
    { kind: 'link', code: 'missing' },
    null,
    'string',
    { ...item('other'), url: 'https://evil.example/other' },
    { ...item('lookalike'), url: 'https://qzz.tw.evil.example/x' },
  ]
  assert.deepEqual(parseHistoryItems(raw).map((i) => i.code), ['good', 'other', 'lookalike'])
  assert.deepEqual(parseHistoryItems(raw, 'https://qzz.tw').map((i) => i.code), ['good'])
  assert.deepEqual(parseHistoryItems({ not: 'an array' }), [])
  // 多的欄位不會被帶進來
  assert.deepEqual(Object.keys(parseHistoryItems([{ ...good, extra: 1 }])[0]!).sort(), Object.keys(good).sort())
})

test('parseHistoryRemovals drops malformed entries', () => {
  const ok = removalOf(item('a'), now)
  assert.deepEqual(parseHistoryRemovals([ok, { ...ok, until: 'never' }, { code: 'x' }, 1]), [ok])
  assert.deepEqual(parseHistoryRemovals(null), [])
})

test('withAdded and withRemoved update the state', () => {
  const added = withAdded(state([item('old', { createdAt: at(-5) })]), item('new', { createdAt: at(0) }), now)
  assert.deepEqual(codes(added), ['link:new', 'link:old'])

  const removed = withRemoved(added, item('old', { createdAt: at(-5) }), now)
  assert.deepEqual(codes(removed), ['link:new'])
  assert.equal(removed.removed.length, 1)
})

test('two sides syncing converge, including deletions', () => {
  // 網站和擴充功能各自建立
  let web = state([item('fromWeb', { createdAt: at(-2) })])
  let ext = state([item('fromExt', { kind: 'paste', url: 'https://qzz.tw/p/fromExt', createdAt: at(-1) })])
  const sync = () => {
    const merged = mergeHistory([web, ext], now)
    web = merged
    ext = merged
  }
  sync()
  assert.deepEqual(codes(web), ['paste:fromExt', 'link:fromWeb'])
  assert.ok(sameHistory(web, ext))

  // 在網站刪掉擴充功能建立的，擴充功能沒同步前又新增一筆
  web = withRemoved(web, ext.items[0]!, now)
  ext = withAdded(ext, item('later', { createdAt: at(0) }), now)
  sync()
  assert.deepEqual(codes(web), ['link:later', 'link:fromWeb'])
  assert.ok(sameHistory(web, ext))
})

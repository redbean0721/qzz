import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_HISTORY_ITEMS, pruneExpired, withAdded, withRemoved, type HistoryItem } from './history'

const now = Date.parse('2026-10-07T00:00:00Z')
const item = (code: string, expiresAt: string | null, kind: HistoryItem['kind'] = 'link'): HistoryItem => ({
  kind,
  code,
  url: `https://qzz.tw/${code}`,
  deleteToken: 't',
  expiresAt,
  createdAt: new Date(now).toISOString(),
})

test('pruneExpired drops only expired items', () => {
  const items = [
    item('past', '2026-10-06T23:59:59Z'),
    item('exact', '2026-10-07T00:00:00Z'),
    item('future', '2026-10-07T00:00:01Z'),
    item('forever', null),
  ]
  assert.deepEqual(pruneExpired(items, now).map((i) => i.code), ['future', 'forever'])
})

test('withAdded puts the new item first, replaces duplicates and caps the list', () => {
  const items = [item('a', null), item('b', null), item('a', null, 'paste')]
  assert.deepEqual(withAdded(items, item('b', null)).map((i) => `${i.kind}:${i.code}`), ['link:b', 'link:a', 'paste:a'])

  const full = Array.from({ length: MAX_HISTORY_ITEMS }, (_, n) => item(`c${n}`, null))
  const added = withAdded(full, item('new', null))
  assert.equal(added.length, MAX_HISTORY_ITEMS)
  assert.equal(added[0]!.code, 'new')
  assert.equal(added.at(-1)!.code, `c${MAX_HISTORY_ITEMS - 2}`)
})

test('withRemoved matches on kind and code', () => {
  const items = [item('a', null), item('a', null, 'paste')]
  assert.deepEqual(withRemoved(items, { kind: 'paste', code: 'a' }).map((i) => i.kind), ['link'])
})

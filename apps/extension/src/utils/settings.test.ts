import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_SETTINGS,
  mergeSettings,
  parseStoredSettings,
  resolveSettings,
  sameSettings,
  withSetting,
  type StoredSettings,
} from '@qzz/shared'

// 設定的合併規則在 @qzz/shared（網站和擴充功能共用），shared 沒有測試設定，所以測在這裡

const now = Date.parse('2026-10-15T00:00:00Z')
const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString()

test('unset settings use the defaults', () => {
  assert.deepEqual(resolveSettings({}), DEFAULT_SETTINGS)
  assert.deepEqual(resolveSettings(withSetting({}, 'autoCopy', false, now)), { ...DEFAULT_SETTINGS, autoCopy: false })
})

test('parseStoredSettings keeps only known settings with valid values', () => {
  const parsed = parseStoredSettings({
    linkExpiresIn: { value: '7d', updatedAt: at(0) },
    pasteExpiresIn: { value: '2y', updatedAt: at(0) },
    pasteLanguage: { value: '<script>', updatedAt: at(0) },
    autoCopy: { value: 'yes', updatedAt: at(0) },
    burnAfterReading: { value: true, updatedAt: 'yesterday' },
    somethingElse: { value: 1, updatedAt: at(0) },
  })
  assert.deepEqual(parsed, { linkExpiresIn: { value: '7d', updatedAt: at(0) } })
  for (const junk of [null, 'x', [], 42]) assert.deepEqual(parseStoredSettings(junk), {})
})

test('mergeSettings takes the newest value of each setting separately', () => {
  let web: StoredSettings = {}
  let ext: StoredSettings = {}
  web = withSetting(web, 'linkExpiresIn', '7d', now)
  ext = withSetting(ext, 'linkExpiresIn', '30d', now + 1000)
  web = withSetting(web, 'autoCopy', false, now + 2000)
  ext = withSetting(ext, 'pasteLanguage', 'python', now)

  const merged = resolveSettings(mergeSettings([web, ext]))
  assert.equal(merged.linkExpiresIn, '30d')
  assert.equal(merged.autoCopy, false)
  assert.equal(merged.pasteLanguage, 'python')
  assert.equal(merged.pasteExpiresIn, DEFAULT_SETTINGS.pasteExpiresIn)
})

test('mergeSettings does not depend on the order, also for equal timestamps', () => {
  const a = withSetting(withSetting({}, 'pasteExpiresIn', '7d', now), 'autoCopy', true, now)
  const b = withSetting(withSetting({}, 'pasteExpiresIn', '1h', now), 'autoCopy', false, now)
  assert.ok(sameSettings(mergeSettings([a, b]), mergeSettings([b, a])))
  const once = mergeSettings([a, b])
  assert.ok(sameSettings(once, mergeSettings([once, a, b])))
})

test('a reset to the default still wins over an older change on the other side', () => {
  const ext = withSetting({}, 'burnAfterReading', true, now)
  const web = withSetting({}, 'burnAfterReading', DEFAULT_SETTINGS.burnAfterReading, now + 1000)
  assert.equal(resolveSettings(mergeSettings([ext, web])).burnAfterReading, false)
})

test('sameSettings ignores key order', () => {
  const a = withSetting(withSetting({}, 'autoCopy', false, now), 'linkExpiresIn', '7d', now)
  const b = withSetting(withSetting({}, 'linkExpiresIn', '7d', now), 'autoCopy', false, now)
  assert.ok(sameSettings(a, b))
  assert.ok(!sameSettings(a, withSetting(a, 'autoCopy', true, now)))
})

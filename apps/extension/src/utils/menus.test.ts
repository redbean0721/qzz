import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MENU, MENUS, urlForMenu } from './menus'

const info = { linkUrl: 'https://example.com/link', srcUrl: 'https://example.com/cat.jpg', pageUrl: 'https://example.com/page' }

test('each shorten menu picks its own URL', () => {
  assert.equal(urlForMenu({ ...info, menuItemId: MENU.shortenLink }), info.linkUrl)
  for (const id of [MENU.shortenImage, MENU.shortenVideo, MENU.shortenAudio]) {
    assert.equal(urlForMenu({ ...info, menuItemId: id }), info.srcUrl, id)
  }
  assert.equal(urlForMenu({ ...info, menuItemId: MENU.shortenPage }), info.pageUrl)
})

test('urlForMenu returns null for the paste menu, unknown ids and missing URLs', () => {
  assert.equal(urlForMenu({ ...info, menuItemId: MENU.createPaste }), null)
  assert.equal(urlForMenu({ ...info, menuItemId: 'something-else' }), null)
  assert.equal(urlForMenu({ menuItemId: MENU.shortenImage }), null)
})

test('menus have unique ids and only offer http(s) links and media', () => {
  assert.equal(new Set(MENUS.map((m) => m.id)).size, MENUS.length)
  for (const menu of MENUS) {
    if (menu.contexts.some((c) => ['link', 'image', 'video', 'audio'].includes(c))) {
      assert.deepEqual(menu.targetUrlPatterns, ['http://*/*', 'https://*/*'], menu.id)
    }
  }
  assert.deepEqual(
    MENUS.filter((m) => ['image', 'video', 'audio'].some((c) => m.contexts.includes(c as never))).map((m) => m.contexts[0]),
    ['image', 'video', 'audio'],
  )
})

// 產生商店用的圖片（Chrome Web Store / AMO）：
//   yarn workspace @qzz/extension build && node apps/extension/store/generate.mjs
// 把正式版擴充功能載入 headless Chrome（暫時的設定檔），攔截對 qzz.tw 的請求回傳假資料，
// 截下彈出視窗，再合成 1280x800 的截圖和 440x280 的宣傳圖。輸出 JPEG（商店要求不能有透明層）。
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const EXT = join(HERE, '../.output/chrome-mv3')
const CHROME = process.env.CHROME ?? '/opt/google/chrome/chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- CDP over pipe ----------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'qzz-store-'))
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--hide-scrollbars',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--lang=zh-TW', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] })

let nextId = 0
const waiting = new Map()
const listeners = []
let buffer = ''
chrome.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString()
  for (let i; (i = buffer.indexOf('\0')) >= 0; ) {
    const msg = JSON.parse(buffer.slice(0, i))
    buffer = buffer.slice(i + 1)
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg)
      waiting.delete(msg.id)
    } else if (msg.method) {
      listeners.forEach((fn) => fn(msg))
    }
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    waiting.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
    chrome.stdio[3].write(`${JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) })}\0`)
  })

async function openTab(url) {
  const { targetId } = await send('Target.createTarget', { url })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed')
    return r.result.value
  }
  return { sessionId, evaluate, send: (method, params) => send(method, params, sessionId) }
}

// ---- 假資料 ------------------------------------------------------------------
const now = Date.now()
const days = (n) => new Date(now + n * 86_400_000).toISOString()
const token = 'x'.repeat(43)
const HISTORY = [
  { kind: 'paste', code: 'Ab3dE9k', url: 'https://qzz.tw/p/Ab3dE9k', deleteToken: token, expiresAt: days(30), createdAt: days(-1) },
  { kind: 'link', code: 'Rb7Lm2Q', url: 'https://qzz.tw/Rb7Lm2Q', target: 'https://developer.mozilla.org/zh-TW/docs/Web/JavaScript', deleteToken: token, expiresAt: days(7), createdAt: days(-2) },
  { kind: 'link', code: 'N4vX8sT', url: 'https://qzz.tw/N4vX8sT', target: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', deleteToken: token, expiresAt: null, createdAt: days(-3) },
]
const NEW_LINK = {
  code: 'Qz7xK2p',
  shortUrl: 'https://qzz.tw/Qz7xK2p',
  url: 'https://github.com/redbean0721/qzz',
  expiresAt: null,
  deleteToken: token,
}
const PASTE_CODE = `// 把網址縮短後複製到剪貼簿
async function shorten(url: string) {
  const res = await fetch(API, {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
  const { shortUrl } = await res.json()
  await copy(shortUrl)
}`

// ---- 截彈出視窗 -----------------------------------------------------------------
const HELPERS = `window.$t = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(fn, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await this.sleep(50) } throw new Error('timeout') },
  async set(el, value, event = 'input') { el.value = value; el.dispatchEvent(new Event(event, { bubbles: true })); await this.sleep(60) },
  tab: (name) => [...document.querySelectorAll('nav button')].find((b) => b.textContent.includes(name)),
}`

async function popupShot(popup) {
  await popup.evaluate('document.activeElement?.blur()')
  await popup.evaluate('document.fonts.ready.then(() => true)')
  const { width, height } = await popup.evaluate(
    '(() => { const r = document.body.getBoundingClientRect(); return { width: Math.ceil(r.width), height: Math.ceil(document.body.scrollHeight) } })()',
  )
  const { data } = await popup.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width, height, scale: 1 },
    captureBeyondViewport: true,
  })
  return { data, width, height }
}

async function render(html, width, height, file) {
  const page = await openTab('about:blank')
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const { frameTree } = await page.send('Page.getFrameTree')
  await page.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html })
  await page.evaluate('Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())]).then(() => true)')
  const { data } = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, clip: { x: 0, y: 0, width, height, scale: 1 } })
  writeFileSync(join(HERE, file), Buffer.from(data, 'base64'))
  console.log(`wrote ${file}`)
}

const FONT = `"Noto Sans CJK TC", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif`
const screenshotHtml = (popup, title, subtitle) => `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; width: 1280px; height: 800px; display: flex; align-items: center; gap: 72px; padding: 0 110px;
    box-sizing: border-box; font-family: ${FONT}; color: #18181b; background: linear-gradient(135deg, #ecfdf5 0%, #f4f4f5 60%); }
  .copy { flex: 1 }
  .brand { font-family: ui-monospace, "DejaVu Sans Mono", monospace; font-weight: 700; font-size: 34px; margin-bottom: 28px }
  .brand span { color: #10b981 }
  h1 { font-size: 46px; line-height: 1.3; margin: 0 0 18px; font-weight: 700 }
  p { font-size: 22px; line-height: 1.7; color: #52525b; margin: 0 }
  img { width: ${Math.round(popup.width * 1.0)}px; max-height: 700px; object-fit: contain; object-position: top;
    border-radius: 14px; box-shadow: 0 24px 60px rgba(24, 24, 27, 0.18), 0 0 0 1px rgba(24, 24, 27, 0.06) }
</style>
<div class="copy"><div class="brand">qzz<span>.tw</span></div><h1>${title}</h1><p>${subtitle}</p></div>
<img src="data:image/png;base64,${popup.data}">`

const ICON_PATHS = [...readFileSync(join(HERE, '../src/assets/icon.svg'), 'utf8').matchAll(/<path d="([^"]+)"/g)].map((m) => m[1])
const promoHtml = `<!doctype html><meta charset="utf-8"><style>
  body { margin: 0; width: 440px; height: 280px; display: flex; align-items: center; gap: 22px; padding: 0 34px;
    box-sizing: border-box; font-family: ${FONT}; color: #fff; background: linear-gradient(135deg, #10b981, #047857) }
  .name { font-family: ui-monospace, "DejaVu Sans Mono", monospace; font-weight: 700; font-size: 44px; line-height: 1 }
  .tag { margin-top: 14px; font-size: 20px; line-height: 1.5; opacity: 0.95 }
</style>
<svg width="104" height="104" viewBox="0 0 128 128"><g fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
  ${ICON_PATHS.map((d) => `<path d="${d}"/>`).join('')}</g></svg>
<div><div class="name">qzz.tw</div><div class="tag">短網址與貼文<br>一鍵縮短、一鍵分享</div></div>`

// ---- main ------------------------------------------------------------------
try {
  const { id } = await send('Extensions.loadUnpacked', { path: EXT })
  await send('Browser.grantPermissions', {
    origin: `chrome-extension://${id}`,
    permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  })

  const popup = await openTab(`chrome-extension://${id}/popup.html`)
  await popup.send('Emulation.setDeviceMetricsOverride', { width: 380, height: 900, deviceScaleFactor: 2, mobile: false })
  await popup.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })

  // 攔截所有送到 qzz.tw 的請求：建立短網址時回傳假結果，不碰正式環境
  await popup.send('Fetch.enable', { patterns: [{ urlPattern: 'https://qzz.tw/*' }] })
  listeners.push((msg) => {
    if (msg.method !== 'Fetch.requestPaused' || msg.sessionId !== popup.sessionId) return
    const body = Buffer.from(JSON.stringify(NEW_LINK)).toString('base64')
    void send('Fetch.fulfillRequest', {
      requestId: msg.params.requestId,
      responseCode: 201,
      responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body,
    }, popup.sessionId)
  })

  await sleep(1000)
  await popup.evaluate(`chrome.storage.local.set({ history: ${JSON.stringify(HISTORY)} }).then(() => true)`)
  await popup.send('Page.reload')
  await sleep(1200)
  await popup.evaluate(HELPERS)

  // 1. 縮短網址：結果卡片（已複製）+ 紀錄
  await popup.evaluate(`(async () => {
    await $t.set(document.querySelector('form input'), ${JSON.stringify(NEW_LINK.url)})
    document.querySelector('form').requestSubmit()
    await $t.until(() => document.querySelector('section.mt-4 button')?.textContent.includes('已複製'))
    return true
  })()`)
  const shot1 = await popupShot(popup)

  // 2. 貼文：填好程式碼、語言、有效期限
  await popup.send('Page.reload')
  await sleep(1200)
  await popup.evaluate(HELPERS)
  await popup.evaluate(`(async () => {
    $t.tab('貼文').click(); await $t.sleep(100)
    const form = document.querySelectorAll('form')[1]
    await $t.set(form.querySelector('textarea'), ${JSON.stringify(PASTE_CODE)})
    const [language, expires] = form.querySelectorAll('select')
    await $t.set(language, 'typescript', 'change')
    await $t.set(expires, '7d', 'change')
    return true
  })()`)
  const shot2 = await popupShot(popup)

  await render(screenshotHtml(shot1, '一鍵縮短<br>目前分頁的網址', '結果自動複製到剪貼簿。<br>在連結或網頁上按右鍵也能縮短，<br>建立過的連結隨時可以刪除。'), 1280, 800, 'screenshot-1-shorten.jpg')
  await render(screenshotHtml(shot2, '選取文字，<br>直接建立貼文', '保留換行和縮排，適合分享程式碼或筆記。<br>可設定 1 小時到永久的有效期限。'), 1280, 800, 'screenshot-2-paste.jpg')
  await render(promoHtml, 440, 280, 'promo-small-440x280.jpg')

  copyFileSync(join(EXT, 'icons/128.png'), join(HERE, 'icon-128.png'))
  console.log('wrote icon-128.png')
} finally {
  chrome.kill()
  await sleep(300)
  rmSync(profile, { recursive: true, force: true })
}

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { BlockedAddressError, createPreviewFetcher, isPublicAddress, parseHead, safeFetch } from './link-preview.js'

test('isPublicAddress only allows public unicast addresses', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '140.112.8.116', '2001:4860:4860::8888', '2606:4700::1111']) {
    assert.equal(isPublicAddress(address), true, address)
  }
  for (const address of [
    '0.0.0.0', '10.0.0.1', '10.42.0.15', '100.64.0.1', '127.0.0.1', '127.255.255.254', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.0.2.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:a00:1', '64:ff9b::a00:1',
    '2001:db8::1', '2002:7f00:1::1', '2001:0:4136:e378::1', 'ff02::1', 'not-an-ip', '',
  ]) {
    assert.equal(isPublicAddress(address), false, address)
  }
})

test('safeFetch refuses loopback and private hosts before connecting', async () => {
  for (const url of [
    'http://localhost/',
    'http://127.0.0.1/',
    'http://0x7f.1/',
    'http://2130706433/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
  ]) {
    await assert.rejects(safeFetch(url), BlockedAddressError, url)
  }
})

test('safeFetch skips non-default ports, credentials and other schemes', async () => {
  for (const url of ['http://example.com:8080/', 'http://user:pass@example.com/', 'ftp://example.com/', 'file:///etc/passwd']) {
    assert.equal(await safeFetch(url), null, url)
  }
})

// 用真的網頁抓下來的 <head>（YouTube 那份把內嵌的 <script> / <style> 內容拿掉了，原本 768 KB）
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf-8')

test('parseHead reads Open Graph tags from real pages', () => {
  const github = parseHead(fixture('github-repo'), new URL('https://github.com/nuxt/nuxt'))
  assert.equal(github.siteName, 'GitHub')
  assert.match(github.title ?? '', /nuxt/i)
  assert.match(github.description ?? '', /Vue framework/)
  assert.match(github.image ?? '', /^https:\/\/opengraph\.githubassets\.com\//)

  const youtube = parseHead(fixture('youtube-video'), new URL('https://www.youtube.com/watch?v=jNQXAC9IVRw'))
  assert.equal(youtube.siteName, 'YouTube')
  assert.equal(youtube.title, 'Me at the zoo')
  // &amp; 要還原成 &
  assert.match(youtube.image ?? '', /^https:\/\/i\.ytimg\.com\/vi\/jNQXAC9IVRw\/hqdefault\.jpg\?[^&]+&rs=/)

  // 沒有 og 標籤：只有 <title>
  const example = parseHead(fixture('example-com'), new URL('https://example.com/'))
  assert.deepEqual(example, { title: 'Example Domain', description: null, siteName: null, image: null, youtube: null })
})

test('parseHead resolves relative images and ignores unsafe ones', () => {
  const page = new URL('https://example.com/a/b')
  const head = (meta: string) => `<html><head>${meta}</head><body><meta property="og:title" content="body"></body>`
  assert.equal(parseHead(head('<meta property="og:image" content="/img.png">'), page).image, 'https://example.com/img.png')
  assert.equal(parseHead(head('<meta property="og:image" content="javascript:alert(1)">'), page).image, null)
  assert.equal(parseHead(head('<meta property="og:image" content="data:image/png;base64,AAAA">'), page).image, null)
  // </head> 之後的不算；屬性順序、單引號、大小寫都可以
  assert.equal(parseHead(head("<META CONTENT='T &#x4e2d;&#25991;' PROPERTY='og:title'>"), page).title, 'T 中文')
  assert.equal(parseHead(head('<title>a‮ b\n c</title>'), page).title, 'a b c')
  assert.equal(parseHead(head(`<meta name="description" content="${'x'.repeat(400)}">`), page).description, 'x'.repeat(300) + '…')
})

// 本機測試伺服器：允許 127.0.0.1 和任意埠，測轉址、壓縮、編碼和讀取上限
let server: Server
let base: string
const allowLocal = { allow: (address: string) => address === '127.0.0.1', anyPort: true }

before(async () => {
  server = createServer((req, res) => {
    const path = req.url ?? '/'
    if (path.startsWith('/redirect/')) {
      const left = Number(path.split('/')[2])
      res.writeHead(302, { location: left > 0 ? `/redirect/${left - 1}` : '/page' }).end()
    } else if (path === '/to-ipv6-loopback') {
      res.writeHead(302, { location: `http://[::1]:${(server.address() as AddressInfo).port}/page` }).end()
    } else if (path === '/page') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<head><meta property="og:title" content="Page"></head>')
    } else if (path === '/gzip') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
      res.end(gzipSync('<head><meta property="og:title" content="壓縮"></head>'))
    } else if (path === '/big5') {
      // 「中文」的 Big5 編碼
      const title = Buffer.from([0xa4, 0xa4, 0xa4, 0xe5])
      res.writeHead(200, { 'content-type': 'text/html; charset=big5' })
      res.end(Buffer.concat([Buffer.from('<head><title>'), title, Buffer.from('</title></head>')]))
    } else if (path === '/endless') {
      // 有 </head> 就不再讀；後面一直送也不會卡住
      res.writeHead(200, { 'content-type': 'text/html' })
      res.write('<head><meta property="og:title" content="Endless"></head>')
      const timer = setInterval(() => res.write('x'.repeat(64 * 1024)), 5)
      res.on('close', () => clearInterval(timer))
    } else if (path === '/late-head') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(`<head><script>${'x'.repeat(800 * 1024)}</script><meta property="og:title" content="Late"></head>`)
    } else if (path === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    } else if (path === '/hang') {
      // 不回應
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => {
  server.closeAllConnections()
  server.close()
})

test('the preview fetcher follows redirects, decompresses and decodes', async () => {
  const fetchPreview = createPreviewFetcher(allowLocal)
  assert.equal((await fetchPreview(`${base}/redirect/2`)).title, 'Page')
  assert.equal((await fetchPreview(`${base}/gzip`)).title, '壓縮')
  assert.equal((await fetchPreview(`${base}/big5`)).title, '中文')
  assert.equal((await fetchPreview(`${base}/late-head`)).title, 'Late')
  // 非 HTML、404 → 空的預覽
  assert.equal((await fetchPreview(`${base}/json`)).title, null)
  assert.equal((await fetchPreview(`${base}/missing`)).title, null)
})

test('safeFetch stops after three redirects and re-checks every hop', async () => {
  assert.equal(await safeFetch(`${base}/redirect/3`, allowLocal), null)
  await assert.rejects(safeFetch(`${base}/to-ipv6-loopback`, allowLocal), BlockedAddressError)
})

test('safeFetch stops reading at </head> and gives up on slow servers', async () => {
  const started = Date.now()
  const endless = await safeFetch(`${base}/endless`, allowLocal)
  assert.match(endless?.body.toString() ?? '', /Endless/)
  assert.ok(Date.now() - started < 2000)

  await assert.rejects(safeFetch(`${base}/hang`, { ...allowLocal, timeoutMs: 200 }), { name: 'AbortError' })
})

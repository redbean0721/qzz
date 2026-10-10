import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import type { Readable } from 'node:stream'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { LinkPreview } from '@qzz/shared'
import { INVISIBLE } from './paste-summary.js'

// 短網址預覽頁的網站卡片：由 API 讀目的地網頁的 <head>，取出 og:title / og:description / og:image。
// 等於讓任何人都能叫伺服器去連某個網址，所以要擋掉內網（SSRF）：
// - 每次連線前解析 DNS，任何一個位址不是公開的網際網路位址就不連；連線用的就是檢查過的位址（擋 DNS rebinding）
// - 網址直接寫 IP 時一樣檢查；只接受 http/https 的預設埠
// - 轉址最多 3 次，每一次都重新檢查；整體 3 秒逾時；最多讀 1 MB，讀到 </head> 就停
// 目的地本身是圖片或影片檔時只看回應標頭、不下載內容，預覽頁直接用 <img> / <video> 顯示（由瀏覽器載入）

const TIMEOUT_MS = 3000
const MAX_REDIRECTS = 3
// YouTube 之類的網站在 og 標籤前面有幾百 KB 的內嵌程式碼
const MAX_BYTES = 1024 * 1024
const MAX_TITLE = 200
const MAX_DESCRIPTION = 300
const MAX_IMAGE_URL = 2048
export const USER_AGENT = 'Mozilla/5.0 (compatible; qzzbot/1.0; +https://qzz.tw/privacy)'

export type AddressCheck = (address: string) => boolean

// 不是公開位址的範圍：本機、私有網路、CGNAT、link-local、文件和測試用、multicast、保留
const BLOCKED_V4 = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  BLOCKED_V4.addSubnet(network, prefix, 'ipv4')
}
// IPv6 只接受全球單播位址（2000::/3），再排除裡面會轉到 IPv4 或文件用的範圍
// （::1、fc00::/7、fe80::/10、::ffff:0:0/96、64:ff9b::/96 都在 2000::/3 外面）
const GLOBAL_V6 = new BlockList()
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6')
const BLOCKED_V6 = new BlockList()
for (const [network, prefix] of [['2001::', 32], ['2001:db8::', 32], ['2002::', 16]] as const) {
  BLOCKED_V6.addSubnet(network, prefix, 'ipv6')
}

export function isPublicAddress(address: string): boolean {
  switch (isIP(address)) {
    case 4:
      return !BLOCKED_V4.check(address, 'ipv4')
    case 6:
      return GLOBAL_V6.check(address, 'ipv6') && !BLOCKED_V6.check(address, 'ipv6')
    default:
      return false
  }
}

export class BlockedAddressError extends Error {}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

// 給 http.request 的 lookup：解析出的位址全部都要是公開的
function guardedLookup(allow: AddressCheck) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, [])
      const blocked = addresses.length === 0 || addresses.some((entry) => !allow(entry.address))
      if (blocked) return callback(new BlockedAddressError(`${hostname} resolves to a non-public address`), [])
      if (options.all) return callback(null, addresses)
      callback(null, addresses[0]!.address, addresses[0]!.family)
    })
  }
}

type Fetched =
  | { kind: 'html'; url: URL; contentType: string; body: Buffer }
  | { kind: 'image'; url: URL; contentType: string }
  | { kind: 'video'; url: URL; contentType: string }

const HTML_TYPE = /^(?:text\/html|application\/xhtml\+xml)\b/i
// <img> 能顯示的格式（SVG 放在 <img> 裡不會執行程式）；影片只收瀏覽器普遍能播的
const IMAGE_TYPE = /^image\/(?:png|jpeg|gif|webp|avif|svg\+xml|bmp)\b/i
const VIDEO_TYPE = /^video\/(?:mp4|webm|ogg)\b/i

function decoded(res: http.IncomingMessage): Readable {
  switch ((res.headers['content-encoding'] ?? '').trim().toLowerCase()) {
    case 'gzip':
    case 'x-gzip':
      return res.pipe(createGunzip())
    case 'deflate':
      return res.pipe(createInflate())
    case 'br':
      return res.pipe(createBrotliDecompress())
    default:
      return res
  }
}

function request(url: URL, allow: AddressCheck, signal: AbortSignal): Promise<http.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http
    const req = client.request(url, {
      method: 'GET',
      agent: false,
      lookup: guardedLookup(allow) as never,
      signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
      },
    })
    req.on('response', resolve)
    req.on('error', reject)
    req.end()
  })
}

// 讀到 </head> 或 MAX_BYTES 就停，連線一起關掉
async function readHead(res: http.IncomingMessage): Promise<Buffer> {
  const stream = decoded(res)
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk)
      size += chunk.length
      if (size >= MAX_BYTES || /<\/head\s*>/i.test(chunk.toString('latin1'))) break
    }
  } finally {
    stream.destroy()
    res.destroy()
  }
  return Buffer.concat(chunks).subarray(0, MAX_BYTES)
}

export type FetchOptions = {
  allow?: AddressCheck
  // 測試用：本機測試伺服器在隨機埠上
  anyPort?: boolean
  timeoutMs?: number
}

export async function safeFetch(target: string, options: FetchOptions = {}): Promise<Fetched | null> {
  const { allow = isPublicAddress, anyPort = false, timeoutMs = TIMEOUT_MS } = options
  const signal = AbortSignal.timeout(timeoutMs)
  let url = new URL(target)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || (url.port !== '' && !anyPort) || url.username || url.password) {
      return null
    }
    // 網址直接寫 IP 時不會經過 lookup
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) && !allow(host)) throw new BlockedAddressError(`${host} is not a public address`)

    const res = await request(url, allow, signal)
    const location = res.headers.location
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && location) {
      res.resume()
      url = new URL(location, url)
      continue
    }

    const contentType = String(res.headers['content-type'] ?? '')
    if (res.statusCode === 200 && HTML_TYPE.test(contentType)) {
      return { kind: 'html', url, contentType, body: await readHead(res) }
    }
    // 其他回應都不讀內容，直接關掉連線（大檔案不會一直下載到逾時）
    res.destroy()
    if (res.statusCode !== 200) return null
    if (IMAGE_TYPE.test(contentType)) return { kind: 'image', url, contentType }
    if (VIDEO_TYPE.test(contentType)) return { kind: 'video', url, contentType }
    return null
  }
  return null
}

// ---- 解析 <head> ----

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })
}

function charsetOf(contentType: string, body: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  if (fromHeader) return fromHeader
  const head = body.subarray(0, 4096).toString('latin1')
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? 'utf-8'
}

function decodeBody(contentType: string, body: Buffer): string {
  try {
    return new TextDecoder(charsetOf(contentType, body)).decode(body)
  } catch {
    // 不認得的編碼
    return new TextDecoder('utf-8').decode(body)
  }
}

const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const match of tag.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase()
    if (!(name in out)) out[name] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '')
  }
  return out
}

function clean(text: string | undefined, max: number): string | null {
  const value = text?.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  if (!value) return null
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function parseHead(html: string, pageUrl: URL): LinkPreview {
  const end = html.search(/<\/head\s*>/i)
  const head = end >= 0 ? html.slice(0, end) : html
  const meta: Record<string, string> = {}
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(tag.slice(5))
    const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
    if (key && attrs.content !== undefined && !(key in meta)) meta[key] = attrs.content
  }
  const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1]

  let image: string | null = null
  const rawImage = meta['og:image'] ?? meta['og:image:url'] ?? meta['og:image:secure_url'] ?? meta['twitter:image']
  if (rawImage) {
    try {
      const resolved = new URL(rawImage.trim(), pageUrl)
      if ((resolved.protocol === 'https:' || resolved.protocol === 'http:') && resolved.href.length <= MAX_IMAGE_URL) {
        image = resolved.href
      }
    } catch {
      // 不是網址就不顯示圖片
    }
  }

  return {
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? (title && decodeEntities(title)), MAX_TITLE),
    description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta.description, MAX_DESCRIPTION),
    siteName: clean(meta['og:site_name'], MAX_TITLE),
    image,
    video: null,
    youtube: null,
  }
}

export const EMPTY_PREVIEW: LinkPreview = {
  title: null,
  description: null,
  siteName: null,
  image: null,
  video: null,
  youtube: null,
}

export type PreviewFetcher = (url: string) => Promise<LinkPreview>

// 圖片 / 影片檔回只有 image / video 的預覽；其他非 HTML、狀態碼不是 200 時回空的預覽（頁面就不顯示卡片）；
// 連線失敗、逾時、被擋會丟錯誤
export function createPreviewFetcher(options: FetchOptions = {}): PreviewFetcher {
  return async (url) => {
    const fetched = await safeFetch(url, options)
    if (!fetched) return EMPTY_PREVIEW
    // 用短網址原本的目的地網址：瀏覽器自己會跟著轉址走（轉址後的網址可能是有時效的簽章網址）
    if (fetched.kind === 'image') return { ...EMPTY_PREVIEW, image: url }
    if (fetched.kind === 'video') return { ...EMPTY_PREVIEW, video: url }
    return parseHead(decodeBody(fetched.contentType, fetched.body), fetched.url)
  }
}

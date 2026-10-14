import type { LinkEmbed, LinkPreview } from '@qzz/shared'
import { EMPTY_PREVIEW, USER_AGENT, type PreviewFetcher } from './link-preview.js'

// 短網址的目的地是支援的影片網站時，預覽頁直接嵌入該網站自己的播放器（網址由 shared 的 embedUrl() 組出）。
// 只接受各網站固定格式的 ID，嵌入網址就不會被塞進其他東西。
// 能事先知道影片不能播的網站先確認，不行就不嵌入、改顯示一般的預覽圖：
// - YouTube：問 oEmbed。200 = 可以嵌入；4xx = 不行（401 禁止嵌入、403 違規移除、404 / 400 找不到）
// - Niconico：問 getthumbinfo。status="fail"（找不到、已刪除）或 <embeddable>0 就不行
// - Bilibili：沒有給伺服器用的 API（會回 412），看網頁本身：已刪除的影片頁有標題（「视频去哪了呢？」）但沒有預覽圖
// - Vimeo、Twitch：不檢查，播放器自己會顯示原因。Vimeo 的 oEmbed 會把可以播的影片回成 404，不能拿來判斷
// 問不到答案（逾時、5xx、網頁讀不到）時照樣嵌入

/** t=90、t=90s、t=90.5、t=1h2m3s → 秒數；看不懂就 0 */
function parseStart(value: string | null): number {
  if (!value) return 0
  let seconds = 0
  if (/^\d+(?:\.\d+)?s?$/.test(value)) {
    seconds = Math.floor(Number.parseFloat(value))
  } else {
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
    if (!match) return 0
    const [, h = '0', m = '0', s = '0'] = match
    seconds = Number(h) * 3600 + Number(m) * 60 + Number(s)
  }
  return Number.isSafeInteger(seconds) ? seconds : 0
}

const segments = (url: URL) => url.pathname.split('/').filter(Boolean)

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])
// 影片 ID 固定 11 碼
const YOUTUBE_ID = /^[\w-]{11}$/
// /shorts/<id>、/embed/<id>、/live/<id>、/v/<id>
const YOUTUBE_PATH = /^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:\/|$)/

function parseYouTube(url: URL, host: string): LinkEmbed | null {
  let id: string | null = null
  if (host === 'youtu.be') {
    id = segments(url)[0] ?? null
  } else if (YOUTUBE_HOSTS.has(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : (YOUTUBE_PATH.exec(url.pathname)?.[1] ?? null)
  } else {
    return null
  }
  if (!id || !YOUTUBE_ID.test(id)) return null
  return { provider: 'youtube', id, start: parseStart(url.searchParams.get('t') ?? url.searchParams.get('start')) }
}

const VIMEO_ID = /^\d{1,12}$/
const VIMEO_HASH = /^[0-9a-f]{1,32}$/

function parseVimeo(url: URL, host: string): LinkEmbed | null {
  const path = segments(url)
  let id: string | undefined
  let hash: string | null = null
  if (host === 'player.vimeo.com') {
    // player.vimeo.com/video/<id>?h=<hash>
    if (path.length !== 2 || path[0] !== 'video') return null
    id = path[1]
    hash = url.searchParams.get('h')
  } else if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    if (path.length <= 2 && VIMEO_ID.test(path[0] ?? '')) {
      // vimeo.com/<id>、不公開影片 vimeo.com/<id>/<hash>
      id = path[0]
      hash = path[1] ?? null
    } else if (path.length === 3 && path[0] === 'channels') {
      id = path[2]
    } else if (path.length === 4 && path[0] === 'groups' && path[2] === 'videos') {
      id = path[3]
    } else if (path.length === 4 && (path[0] === 'showcase' || path[0] === 'album') && path[2] === 'video') {
      id = path[3]
    }
  } else {
    return null
  }
  if (!id || !VIMEO_ID.test(id) || (hash !== null && !VIMEO_HASH.test(hash))) return null
  // 開始時間放在 #t=1m30s
  const start = parseStart(new URLSearchParams(url.hash.slice(1)).get('t'))
  return { provider: 'vimeo', id, hash, start }
}

const TWITCH_HOSTS = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv'])
const TWITCH_CHANNEL = /^\w{3,25}$/
const TWITCH_VIDEO = /^\d{1,15}$/
const TWITCH_CLIP = /^[\w-]{1,100}$/
// twitch.tv/<一段> 不一定是頻道
const TWITCH_RESERVED = new Set([
  'directory', 'videos', 'settings', 'subscriptions', 'inventory', 'wallet', 'drops', 'downloads', 'jobs', 'search',
  'store', 'turbo', 'friends', 'messages', 'prime', 'bits', 'broadcast', 'creatorcamp', 'user', 'login', 'signup',
  'logout', 'privacy', 'legal', 'security', 'products', 'team', 'moderator', 'popout', 'embed', 'following', 'payments',
  'redeem', 'activate', 'partner', 'safety', 'clips', 'collections', 'event', 'schedule', 'dashboard', 'emotes',
])

function parseTwitch(url: URL, host: string): LinkEmbed | null {
  const path = segments(url)
  if (host === 'clips.twitch.tv') {
    // clips.twitch.tv/<slug>
    const [slug] = path
    if (path.length !== 1 || !slug || slug === 'embed' || !TWITCH_CLIP.test(slug)) return null
    return { provider: 'twitch', kind: 'clip', id: slug, start: 0 }
  }
  if (!TWITCH_HOSTS.has(host)) return null
  const [first, second, third] = path
  if (path.length === 2 && first === 'videos' && second && TWITCH_VIDEO.test(second)) {
    return { provider: 'twitch', kind: 'video', id: second, start: parseStart(url.searchParams.get('t')) }
  }
  if (path.length === 3 && second === 'clip' && third && TWITCH_CLIP.test(third)) {
    return { provider: 'twitch', kind: 'clip', id: third, start: 0 }
  }
  if (path.length === 1 && first && TWITCH_CHANNEL.test(first) && !TWITCH_RESERVED.has(first.toLowerCase())) {
    return { provider: 'twitch', kind: 'channel', id: first.toLowerCase(), start: 0 }
  }
  return null
}

const BILIBILI_HOSTS = new Set(['bilibili.com', 'www.bilibili.com', 'm.bilibili.com'])
const BILIBILI_BV = /^BV1[0-9A-Za-z]{9}$/
const BILIBILI_AV = /^av(\d{1,12})$/i

function parseBilibili(url: URL, host: string): LinkEmbed | null {
  if (!BILIBILI_HOSTS.has(host)) return null
  // bilibili.com/video/<BV 號或 av 號>/?p=2&t=60
  const path = segments(url)
  if (path.length !== 2 || path[0] !== 'video' || !path[1]) return null
  const raw = path[1]
  const av = BILIBILI_AV.exec(raw)
  const id = BILIBILI_BV.test(raw) ? raw : av ? `av${av[1]}` : null
  if (!id) return null
  const page = Number(url.searchParams.get('p') ?? '1')
  return {
    provider: 'bilibili',
    id,
    page: Number.isSafeInteger(page) && page >= 1 ? page : 1,
    start: parseStart(url.searchParams.get('t')),
  }
}

const NICONICO_HOSTS = new Set(['nicovideo.jp', 'www.nicovideo.jp', 'sp.nicovideo.jp', 'embed.nicovideo.jp'])
const NICONICO_ID = /^(?:sm|so|nm)\d{1,12}$/

function parseNiconico(url: URL, host: string): LinkEmbed | null {
  const path = segments(url)
  let id: string | undefined
  if (host === 'nico.ms' && path.length === 1) id = path[0]
  else if (NICONICO_HOSTS.has(host) && path.length === 2 && path[0] === 'watch') id = path[1]
  if (!id || !NICONICO_ID.test(id)) return null
  // 開始時間是 ?from=秒數
  return { provider: 'niconico', id, start: parseStart(url.searchParams.get('from')) }
}

const PARSERS = [parseYouTube, parseVimeo, parseTwitch, parseBilibili, parseNiconico]

/** 短網址的目的地是支援的影片網站時，回傳要嵌入的影片 */
export function parseEmbedUrl(input: string): LinkEmbed | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.toLowerCase()
  for (const parse of PARSERS) {
    const embed = parse(url, host)
    if (embed) return embed
  }
  return null
}

const CHECK_TIMEOUT_MS = 3000

/** 向影片網站查詢；網站沒有回答（逾時、5xx）時回傳 true，照樣嵌入 */
async function ask(url: string, fetchImpl: typeof fetch, decide: (res: Response) => Promise<boolean>): Promise<boolean> {
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    if (res.status >= 500) {
      await res.body?.cancel()
      return true
    }
    return await decide(res)
  } catch {
    return true
  }
}

export function checkYouTubeEmbed(id: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = `https://www.youtube.com/oembed?${new URLSearchParams({ format: 'json', url: `https://www.youtube.com/watch?v=${id}` })}`
  return ask(url, fetchImpl, async (res) => {
    await res.body?.cancel()
    return !(res.status >= 400 && res.status < 500)
  })
}

export function checkNiconicoEmbed(id: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  // 找不到的影片也是 200，看 XML 的 status 和 embeddable
  return ask(`https://ext.nicovideo.jp/api/getthumbinfo/${id}`, fetchImpl, async (res) => {
    if (!res.ok) {
      await res.body?.cancel()
      return false
    }
    const xml = await res.text()
    return !/<nicovideo_thumb_response\s+status="fail"/.test(xml) && !/<embeddable>0<\/embeddable>/.test(xml)
  })
}

/** 讀到了 Bilibili 的網頁，有標題卻沒有預覽圖 = 影片已刪除或不存在 */
export function bilibiliPageLooksPlayable(head: LinkPreview | null): boolean {
  return !head?.title || head.image !== null
}

/** head：目的地網頁的網站卡片，讀不到時是 null */
export type EmbedCheck = (embed: LinkEmbed, head: Promise<LinkPreview | null>) => Promise<boolean>

export function createEmbedCheck(fetchImpl: typeof fetch = fetch): EmbedCheck {
  return async (embed, head) => {
    switch (embed.provider) {
      case 'youtube':
        return checkYouTubeEmbed(embed.id, fetchImpl)
      case 'niconico':
        return checkNiconicoEmbed(embed.id, fetchImpl)
      case 'bilibili':
        return bilibiliPageLooksPlayable(await head)
      case 'vimeo':
      case 'twitch':
        return true
    }
  }
}

/** 在網站卡片的抓取外面包一層：目的地是支援的影片網站、而且可以嵌入時帶上 embed */
export function withEmbed(fetchHead: PreviewFetcher, check: EmbedCheck = createEmbedCheck()): PreviewFetcher {
  return async (url) => {
    const embed = parseEmbedUrl(url)
    if (!embed) return fetchHead(url)
    // 讀不到影片網站的網頁時還是可以嵌入，所以這裡不讓錯誤往外丟；查詢和讀網頁同時進行
    const head = fetchHead(url).catch(() => null)
    const [page, embeddable] = await Promise.all([head, check(embed, head)])
    const preview: LinkPreview = { ...(page ?? EMPTY_PREVIEW), embed: embeddable ? embed : null }
    // 已刪除的 Bilibili 影片頁，描述是沒填好的範本（「{$0}, 视频播放量 undefined、弹幕量 {$1}…」），只留標題
    if (embed.provider === 'bilibili' && !embeddable) preview.description = null
    return preview
  }
}

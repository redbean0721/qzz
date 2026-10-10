import { EMPTY_PREVIEW, USER_AGENT, type PreviewFetcher } from './link-preview.js'

// 短網址的目的地是 YouTube 影片時，預覽頁直接嵌入 YouTube 的播放器。
// 有些影片的擁有者禁止嵌入（或影片已被移除），嵌入只會顯示「無法播放」，所以先問 YouTube 的 oEmbed：
// 200 = 可以嵌入；4xx = 不行（401 禁止嵌入、403 違規移除、404 / 400 找不到），改顯示一般的預覽圖；
// 逾時或 5xx 不知道答案，照樣嵌入（播放器自己會顯示原因和「在 YouTube 上觀看」）

export interface YouTubeVideo {
  id: string
  /** 開始秒數（網址的 t= / start=） */
  start: number
}

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
])
// 影片 ID 固定 11 碼；只接受這個格式，嵌入網址就不會被塞進其他東西
const VIDEO_ID = /^[\w-]{11}$/
// /shorts/<id>、/embed/<id>、/live/<id>、/v/<id>
const PATH_ID = /^\/(?:shorts|embed|live|v)\/([\w-]{11})(?:\/|$)/

/** t=90、t=90s、t=1h2m3s → 秒數；看不懂就 0 */
function parseStart(value: string | null): number {
  if (!value) return 0
  if (/^\d+s?$/.test(value)) return Number.parseInt(value, 10)
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(value)
  if (!match) return 0
  const [, h = '0', m = '0', s = '0'] = match
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

/** 短網址的目的地是 YouTube 影片時回傳影片 ID 和開始秒數 */
export function parseYouTubeUrl(input: string): YouTubeVideo | null {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const host = url.hostname.toLowerCase()
  let id: string | null = null
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0] ?? null
  } else if (HOSTS.has(host)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : (PATH_ID.exec(url.pathname)?.[1] ?? null)
  }
  if (!id || !VIDEO_ID.test(id)) return null

  return { id, start: parseStart(url.searchParams.get('t') ?? url.searchParams.get('start')) }
}

const OEMBED_TIMEOUT_MS = 3000

export type EmbedCheck = (id: string) => Promise<boolean>

export async function checkYouTubeEmbed(id: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = `https://www.youtube.com/oembed?${new URLSearchParams({ format: 'json', url: `https://www.youtube.com/watch?v=${id}` })}`
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS) })
    await res.body?.cancel()
    return !(res.status >= 400 && res.status < 500)
  } catch {
    return true
  }
}

/** 在網站卡片的抓取外面包一層：YouTube 影片同時問 oEmbed，可以嵌入就帶上 youtube */
export function withYouTubeEmbed(fetchHead: PreviewFetcher, checkEmbed: EmbedCheck = checkYouTubeEmbed): PreviewFetcher {
  return async (url) => {
    const video = parseYouTubeUrl(url)
    if (!video) return fetchHead(url)
    // 讀不到 YouTube 網頁的標題時還是可以嵌入，所以這裡不讓錯誤往外丟
    const [head, embeddable] = await Promise.all([fetchHead(url).catch(() => EMPTY_PREVIEW), checkEmbed(video.id)])
    return { ...head, youtube: embeddable ? video : null }
  }
}

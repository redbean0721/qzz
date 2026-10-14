import { z } from 'zod'

// 短網址預覽頁直接嵌入的影片網站播放器。API 從目的地網址解析出影片（apps/api/src/lib/embed.ts），
// 網頁用 embedUrl() 組出 iframe 的網址：播放器的網域固定在這裡，ID 也只接受各網站的格式
export const EMBED_PROVIDERS = ['youtube', 'vimeo', 'twitch', 'bilibili', 'niconico'] as const

/** 開始秒數，0 = 從頭 */
const start = z.number().int().nonnegative()

export const linkEmbedSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('youtube'), id: z.string().regex(/^[\w-]{11}$/), start }),
  // hash：不公開影片網址裡的第二段（vimeo.com/<id>/<hash>）
  z.object({ provider: z.literal('vimeo'), id: z.string().regex(/^\d+$/), hash: z.string().regex(/^[0-9a-f]+$/).nullable(), start }),
  // channel = 直播（id 是頻道名稱）、video = 過去的直播（id 是數字）、clip = 剪輯（id 是 slug）
  z.object({
    provider: z.literal('twitch'),
    kind: z.enum(['channel', 'video', 'clip']),
    id: z.string().regex(/^[\w-]{1,100}$/),
    start,
  }),
  // id：BV 號或 av 號；page：分 P（?p=）
  z.object({
    provider: z.literal('bilibili'),
    id: z.string().regex(/^(?:BV1[0-9A-Za-z]{9}|av\d+)$/),
    page: z.number().int().positive(),
    start,
  }),
  z.object({ provider: z.literal('niconico'), id: z.string().regex(/^(?:sm|so|nm)\d+$/), start }),
])

export type LinkEmbed = z.infer<typeof linkEmbedSchema>

/** 90 → 0h1m30s（Twitch 的 time= 格式） */
function twitchTime(seconds: number): string {
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)}m${seconds % 60}s`
}

/**
 * 播放器 iframe 的網址。parent 是嵌入它的網頁的主機名稱（Twitch 規定要帶，而且只接受網域或 localhost，
 * 用 IP 開的頁面會顯示設定錯誤）
 */
export function embedUrl(embed: LinkEmbed, parent: string): string {
  switch (embed.provider) {
    case 'youtube': {
      // 隱私強化模式
      const query = embed.start ? `?start=${embed.start}` : ''
      return `https://www.youtube-nocookie.com/embed/${embed.id}${query}`
    }
    case 'vimeo': {
      // dnt=1：不記錄觀看資料、不設追蹤 cookie
      const query = new URLSearchParams({ dnt: '1' })
      if (embed.hash) query.set('h', embed.hash)
      return `https://player.vimeo.com/video/${embed.id}?${query}${embed.start ? `#t=${embed.start}s` : ''}`
    }
    case 'twitch': {
      if (embed.kind === 'clip') {
        return `https://clips.twitch.tv/embed?${new URLSearchParams({ clip: embed.id, parent, autoplay: 'false' })}`
      }
      const query =
        embed.kind === 'channel' ? new URLSearchParams({ channel: embed.id }) : new URLSearchParams({ video: `v${embed.id}` })
      query.set('parent', parent)
      query.set('autoplay', 'false')
      if (embed.kind === 'video' && embed.start) query.set('time', twitchTime(embed.start))
      return `https://player.twitch.tv/?${query}`
    }
    case 'bilibili': {
      const query = new URLSearchParams({ isOutside: 'true' })
      if (embed.id.startsWith('BV')) query.set('bvid', embed.id)
      else query.set('aid', embed.id.slice(2))
      query.set('p', String(embed.page))
      query.set('autoplay', '0')
      if (embed.start) query.set('t', String(embed.start))
      return `https://player.bilibili.com/player.html?${query}`
    }
    case 'niconico':
      return `https://embed.nicovideo.jp/watch/${embed.id}${embed.start ? `?from=${embed.start}` : ''}`
  }
}

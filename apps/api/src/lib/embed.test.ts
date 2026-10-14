import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { embedUrl, linkEmbedSchema, type LinkEmbed, type LinkPreview } from '@qzz/shared'
import {
  bilibiliPageLooksPlayable,
  checkNiconicoEmbed,
  checkYouTubeEmbed,
  createEmbedCheck,
  parseEmbedUrl,
  withEmbed,
} from './embed.js'
import { EMPTY_PREVIEW, parseHead } from './link-preview.js'

const youtube = (id: string, start = 0): LinkEmbed => ({ provider: 'youtube', id, start })

test('parseEmbedUrl finds YouTube videos and start times', () => {
  const cases: Array<[string, LinkEmbed | null]> = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', youtube('dQw4w9WgXcQ', 90)],
    ['https://m.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&t=42', youtube('dQw4w9WgXcQ', 42)],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc&t=1h2m3s', youtube('dQw4w9WgXcQ', 3723)],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', youtube('dQw4w9WgXcQ')],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?start=10', youtube('dQw4w9WgXcQ', 10)],
    ['https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ', youtube('dQw4w9WgXcQ')],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=abc', youtube('dQw4w9WgXcQ')],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=99999999999999999999', youtube('dQw4w9WgXcQ')],
    ['https://www.youtube.com/playlist?list=PL1', null],
    ['https://www.youtube.com/@channel', null],
    ['https://www.youtube.com/watch?v=short', null],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ"><x', null],
    ['https://youtu.be/', null],
    ['https://evil.com/watch?v=dQw4w9WgXcQ', null],
    ['https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', null],
    ['javascript://youtube.com/watch?v=dQw4w9WgXcQ', null],
    ['not a url', null],
  ]
  for (const [url, expected] of cases) assert.deepEqual(parseEmbedUrl(url), expected, url)
})

test('parseEmbedUrl finds Vimeo, Twitch, Bilibili and Niconico videos', () => {
  const cases: Array<[string, LinkEmbed | null]> = [
    ['https://vimeo.com/22439234', { provider: 'vimeo', id: '22439234', hash: null, start: 0 }],
    ['https://vimeo.com/22439234#t=1m30s', { provider: 'vimeo', id: '22439234', hash: null, start: 90 }],
    ['https://vimeo.com/22439234/5a2f2b1c9d', { provider: 'vimeo', id: '22439234', hash: '5a2f2b1c9d', start: 0 }],
    ['https://vimeo.com/channels/staffpicks/22439234', { provider: 'vimeo', id: '22439234', hash: null, start: 0 }],
    ['https://vimeo.com/groups/shortfilms/videos/22439234', { provider: 'vimeo', id: '22439234', hash: null, start: 0 }],
    ['https://vimeo.com/showcase/123/video/22439234', { provider: 'vimeo', id: '22439234', hash: null, start: 0 }],
    ['https://player.vimeo.com/video/22439234?h=5a2f2b1c9d', { provider: 'vimeo', id: '22439234', hash: '5a2f2b1c9d', start: 0 }],
    ['https://vimeo.com/22439234/not-a-hash', null],
    ['https://vimeo.com/terjes', null],
    ['https://vimeo.com/channels/staffpicks', null],

    ['https://www.twitch.tv/monstercat', { provider: 'twitch', kind: 'channel', id: 'monstercat', start: 0 }],
    ['https://m.twitch.tv/MonsterCat/', { provider: 'twitch', kind: 'channel', id: 'monstercat', start: 0 }],
    ['https://www.twitch.tv/videos/1990742383?t=1h2m3s', { provider: 'twitch', kind: 'video', id: '1990742383', start: 3723 }],
    ['https://www.twitch.tv/monstercat/clip/SassyObliquePandaChefFrank', { provider: 'twitch', kind: 'clip', id: 'SassyObliquePandaChefFrank', start: 0 }],
    ['https://clips.twitch.tv/SassyObliquePandaChefFrank-AbC_12', { provider: 'twitch', kind: 'clip', id: 'SassyObliquePandaChefFrank-AbC_12', start: 0 }],
    ['https://www.twitch.tv/directory', null],
    ['https://www.twitch.tv/Settings', null],
    ['https://www.twitch.tv/monstercat/videos', null],
    ['https://clips.twitch.tv/embed', null],

    ['https://www.bilibili.com/video/BV1hJp469Eo4/', { provider: 'bilibili', id: 'BV1hJp469Eo4', page: 1, start: 0 }],
    ['https://m.bilibili.com/video/BV1hJp469Eo4?p=2&t=60.5', { provider: 'bilibili', id: 'BV1hJp469Eo4', page: 2, start: 60 }],
    ['https://www.bilibili.com/video/AV170001?p=x', { provider: 'bilibili', id: 'av170001', page: 1, start: 0 }],
    ['https://www.bilibili.com/video/BV1hJp469Eo4x', null],
    ['https://space.bilibili.com/video/BV1hJp469Eo4', null],

    ['https://www.nicovideo.jp/watch/sm9?from=60', { provider: 'niconico', id: 'sm9', start: 60 }],
    ['https://sp.nicovideo.jp/watch/so38016254', { provider: 'niconico', id: 'so38016254', start: 0 }],
    ['https://nico.ms/sm9', { provider: 'niconico', id: 'sm9', start: 0 }],
    ['https://www.nicovideo.jp/watch/lv1234', null],
    ['https://www.nicovideo.jp/user/4', null],
  ]
  for (const [url, expected] of cases) {
    const embed = parseEmbedUrl(url)
    assert.deepEqual(embed, expected, url)
    // 網頁拿到的一定通過 shared 的格式檢查
    if (embed) linkEmbedSchema.parse(embed)
  }
})

test('embedUrl builds each player URL', () => {
  const cases: Array<[LinkEmbed, string]> = [
    [youtube('dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    [youtube('dQw4w9WgXcQ', 42), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42'],
    [{ provider: 'vimeo', id: '22439234', hash: null, start: 0 }, 'https://player.vimeo.com/video/22439234?dnt=1'],
    [{ provider: 'vimeo', id: '22439234', hash: 'abc', start: 90 }, 'https://player.vimeo.com/video/22439234?dnt=1&h=abc#t=90s'],
    [
      { provider: 'twitch', kind: 'channel', id: 'monstercat', start: 0 },
      'https://player.twitch.tv/?channel=monstercat&parent=qzz.tw&autoplay=false',
    ],
    [
      { provider: 'twitch', kind: 'video', id: '1990742383', start: 3723 },
      'https://player.twitch.tv/?video=v1990742383&parent=qzz.tw&autoplay=false&time=1h2m3s',
    ],
    [
      { provider: 'twitch', kind: 'clip', id: 'SassyObliquePandaChefFrank', start: 0 },
      'https://clips.twitch.tv/embed?clip=SassyObliquePandaChefFrank&parent=qzz.tw&autoplay=false',
    ],
    [
      { provider: 'bilibili', id: 'BV1hJp469Eo4', page: 2, start: 60 },
      'https://player.bilibili.com/player.html?isOutside=true&bvid=BV1hJp469Eo4&p=2&autoplay=0&t=60',
    ],
    [
      { provider: 'bilibili', id: 'av170001', page: 1, start: 0 },
      'https://player.bilibili.com/player.html?isOutside=true&aid=170001&p=1&autoplay=0',
    ],
    [{ provider: 'niconico', id: 'sm9', start: 60 }, 'https://embed.nicovideo.jp/watch/sm9?from=60'],
  ]
  for (const [embed, expected] of cases) assert.equal(embedUrl(embed, 'qzz.tw'), expected)
})

// 實際向各網站抓下來的回應（apps/api/src/lib/fixtures/*.json，用程式寫入）
type Captured = { id: string; note: string; status: number; contentType: string; body: string }
const load = (name: string): Captured[] =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf-8'))

function replay(captured: Captured[], idOf: (url: URL) => string | null, requested: string[]): typeof fetch {
  return async (input) => {
    const url = new URL(String(input))
    requested.push(url.href)
    const id = idOf(url)
    const res = captured.find((c) => c.id === id)
    if (!res) throw new Error(`no captured response for ${id}`)
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.contentType } })
  }
}

test('checkYouTubeEmbed follows the oEmbed status codes', async () => {
  const captured = load('youtube-oembed')
  const requested: string[] = []
  const fetchImpl = replay(captured, (url) => new URL(url.searchParams.get('url') ?? '').searchParams.get('v'), requested)
  const expected: Record<string, boolean> = {
    dQw4w9WgXcQ: true, // 可以嵌入
    '6srEO4PALsg': false, // 401：擁有者禁止嵌入
    Cr381pDsSsA: false, // 403：違反服務條款被移除
    uYwwn1qJzBw: false, // 404
    aaaaaaaaaaa: false, // 400
  }
  for (const { id } of captured) assert.equal(await checkYouTubeEmbed(id, fetchImpl), expected[id], id)
  assert.equal(
    requested[0],
    'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ',
  )
})

test('checkNiconicoEmbed reads getthumbinfo', async () => {
  const captured = load('niconico-thumbinfo')
  const requested: string[] = []
  const fetchImpl = replay(captured, (url) => url.pathname.split('/').pop() ?? null, requested)
  assert.equal(await checkNiconicoEmbed('sm9', fetchImpl), true)
  assert.equal(await checkNiconicoEmbed('sm1', fetchImpl), false) // NOT_FOUND
  assert.equal(requested[0], 'https://ext.nicovideo.jp/api/getthumbinfo/sm9')
})

test('checks still embed when the site does not answer', async () => {
  const down: typeof fetch = async () => new Response('Service Unavailable', { status: 503 })
  const offline: typeof fetch = async () => {
    throw new TypeError('fetch failed')
  }
  for (const fetchImpl of [down, offline]) {
    assert.equal(await checkYouTubeEmbed('dQw4w9WgXcQ', fetchImpl), true)
    assert.equal(await checkNiconicoEmbed('sm9', fetchImpl), true)
  }
})

test('Bilibili videos are embedded unless the page says they are gone', () => {
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}.html`, import.meta.url), 'utf-8')
  const video = parseHead(fixture('bilibili-video'), new URL('https://www.bilibili.com/video/BV1hJp469Eo4/'))
  const deleted = parseHead(fixture('bilibili-deleted'), new URL('https://www.bilibili.com/video/BV1GJ411x7h7/'))
  assert.match(video.title ?? '', /Letters to me/)
  assert.equal(bilibiliPageLooksPlayable(video), true)
  // 已刪除：標題是「视频去哪了呢？」，沒有預覽圖
  assert.match(deleted.title ?? '', /视频去哪了呢/)
  assert.equal(bilibiliPageLooksPlayable(deleted), false)
  // 網頁讀不到（逾時、被擋）時照樣嵌入
  assert.equal(bilibiliPageLooksPlayable(null), true)
  assert.equal(bilibiliPageLooksPlayable(EMPTY_PREVIEW), true)
})

test('createEmbedCheck only asks the sites that can answer', async () => {
  const requested: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    requested.push(String(input))
    return new Response(null, { status: 404 })
  }
  const check = createEmbedCheck(fetchImpl)
  const noHead = Promise.resolve(null)
  assert.equal(await check(youtube('dQw4w9WgXcQ'), noHead), false)
  assert.equal(await check({ provider: 'niconico', id: 'sm9', start: 0 }, noHead), false)
  assert.equal(await check({ provider: 'vimeo', id: '1', hash: null, start: 0 }, noHead), true)
  assert.equal(await check({ provider: 'twitch', kind: 'channel', id: 'monstercat', start: 0 }, noHead), true)
  const gone = Promise.resolve({ ...EMPTY_PREVIEW, title: '视频去哪了呢？_哔哩哔哩_bilibili' })
  assert.equal(await check({ provider: 'bilibili', id: 'BV1GJ411x7h7', page: 1, start: 0 }, gone), false)
  assert.equal(requested.length, 2)
})

test('withEmbed adds the video only when it can be embedded', async () => {
  const head: LinkPreview = { ...EMPTY_PREVIEW, title: 'Video', image: 'https://i.ytimg.com/vi/x/hq.jpg' }
  const fetched: string[] = []
  const checked: string[] = []
  const fetcher = (embeddable: boolean, fail = false) =>
    withEmbed(
      async (url) => {
        fetched.push(url)
        if (fail) throw new Error('timeout')
        return head
      },
      async (embed) => {
        checked.push(embed.id)
        return embeddable
      },
    )

  const url = 'https://youtu.be/dQw4w9WgXcQ?t=42'
  const video = youtube('dQw4w9WgXcQ', 42)
  assert.deepEqual(await fetcher(true)(url), { ...head, embed: video })
  assert.deepEqual(await fetcher(false)(url), head)
  // 讀不到網頁也照樣嵌入
  assert.deepEqual(await fetcher(true, true)(url), { ...EMPTY_PREVIEW, embed: video })

  // 不是影片網站：不檢查，錯誤照樣往外丟（快取記成失敗）
  assert.deepEqual(await fetcher(true)('https://example.com/'), head)
  await assert.rejects(fetcher(true, true)('https://example.com/'), /timeout/)
  assert.deepEqual(checked, ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ'])
  assert.equal(fetched.length, 5)
})

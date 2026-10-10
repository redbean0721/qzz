import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { LinkPreview } from '@qzz/shared'
import { EMPTY_PREVIEW } from './link-preview.js'
import { checkYouTubeEmbed, parseYouTubeUrl, withYouTubeEmbed } from './youtube.js'

test('parseYouTubeUrl finds the video id and start time', () => {
  const cases: Array<[string, ReturnType<typeof parseYouTubeUrl>]> = [
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', { id: 'dQw4w9WgXcQ', start: 0 }],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s', { id: 'dQw4w9WgXcQ', start: 90 }],
    ['https://m.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ&t=42', { id: 'dQw4w9WgXcQ', start: 42 }],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc&t=1h2m3s', { id: 'dQw4w9WgXcQ', start: 3723 }],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', { id: 'dQw4w9WgXcQ', start: 0 }],
    ['https://www.youtube.com/live/dQw4w9WgXcQ?feature=share', { id: 'dQw4w9WgXcQ', start: 0 }],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ?start=10', { id: 'dQw4w9WgXcQ', start: 10 }],
    ['https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ', { id: 'dQw4w9WgXcQ', start: 0 }],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=abc', { id: 'dQw4w9WgXcQ', start: 0 }],
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
  for (const [url, expected] of cases) assert.deepEqual(parseYouTubeUrl(url), expected, url)
})

// 實際向 YouTube oEmbed 抓下來的回應（apps/api/src/lib/fixtures/youtube-oembed.json，用程式寫入）
type Captured = { id: string; note: string; status: number; contentType: string; body: string }
const captured: Captured[] = JSON.parse(readFileSync(new URL('./fixtures/youtube-oembed.json', import.meta.url), 'utf-8'))

function replay(requested: string[]): typeof fetch {
  return async (input) => {
    const url = new URL(String(input))
    requested.push(url.href)
    const id = new URL(url.searchParams.get('url') ?? '').searchParams.get('v')
    const res = captured.find((c) => c.id === id)
    if (!res) throw new Error(`no captured response for ${id}`)
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.contentType } })
  }
}

test('checkYouTubeEmbed follows the oEmbed status codes', async () => {
  const requested: string[] = []
  const expected: Record<string, boolean> = {
    dQw4w9WgXcQ: true, // 可以嵌入
    '6srEO4PALsg': false, // 401：擁有者禁止嵌入
    Cr381pDsSsA: false, // 403：違反服務條款被移除
    uYwwn1qJzBw: false, // 404
    aaaaaaaaaaa: false, // 400
  }
  for (const { id } of captured) assert.equal(await checkYouTubeEmbed(id, replay(requested)), expected[id], id)
  assert.equal(
    requested[0],
    'https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ',
  )
})

test('checkYouTubeEmbed still embeds when YouTube does not answer', async () => {
  const down: typeof fetch = async () => new Response('Service Unavailable', { status: 503 })
  const offline: typeof fetch = async () => {
    throw new TypeError('fetch failed')
  }
  assert.equal(await checkYouTubeEmbed('dQw4w9WgXcQ', down), true)
  assert.equal(await checkYouTubeEmbed('dQw4w9WgXcQ', offline), true)
})

test('withYouTubeEmbed adds the video only when it can be embedded', async () => {
  const head: LinkPreview = { ...EMPTY_PREVIEW, title: 'Video', image: 'https://i.ytimg.com/vi/x/hq.jpg' }
  const fetched: string[] = []
  const checked: string[] = []
  const fetcher = (embeddable: boolean, fail = false) =>
    withYouTubeEmbed(
      async (url) => {
        fetched.push(url)
        if (fail) throw new Error('timeout')
        return head
      },
      async (id) => {
        checked.push(id)
        return embeddable
      },
    )

  const url = 'https://youtu.be/dQw4w9WgXcQ?t=42'
  assert.deepEqual(await fetcher(true)(url), { ...head, youtube: { id: 'dQw4w9WgXcQ', start: 42 } })
  assert.deepEqual(await fetcher(false)(url), head)
  // 讀不到網頁也照樣嵌入
  assert.deepEqual(await fetcher(true, true)(url), { ...EMPTY_PREVIEW, youtube: { id: 'dQw4w9WgXcQ', start: 42 } })

  // 不是 YouTube：不問 oEmbed，錯誤照樣往外丟（快取記成失敗）
  assert.deepEqual(await fetcher(true)('https://example.com/'), head)
  await assert.rejects(fetcher(true, true)('https://example.com/'), /timeout/)
  assert.deepEqual(checked, ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'dQw4w9WgXcQ'])
  assert.equal(fetched.length, 5)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSafeBrowsingChecker } from './safe-browsing.js'

function fakeFetch(respond: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: URL[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(url)
    return respond(url, init)
  }) as typeof fetch
  return { fn, calls }
}

test('sends the key and URL to v5 urls:search', async () => {
  const { fn, calls } = fakeFetch(() => Response.json({}))
  await createSafeBrowsingChecker('test-key', { fetch: fn })('https://example.com/a?b=c&d=e')

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.origin + calls[0]!.pathname, 'https://safebrowsing.googleapis.com/v5/urls:search')
  assert.equal(calls[0]!.searchParams.get('key'), 'test-key')
  assert.deepEqual(calls[0]!.searchParams.getAll('urls'), ['https://example.com/a?b=c&d=e'])
})

test('no threats means safe', async () => {
  const { fn } = fakeFetch(() => Response.json({ cacheDuration: '300s' }))
  assert.deepEqual(await createSafeBrowsingChecker('k', { fetch: fn })('https://example.com'), { status: 'safe' })
})

test('threat matches mean unsafe, with de-duplicated threat types', async () => {
  const { fn } = fakeFetch(() =>
    Response.json({
      threats: [
        { url: 'https://evil.example/', threatTypes: ['SOCIAL_ENGINEERING', 'MALWARE'] },
        { url: 'https://evil.example/', threatTypes: ['MALWARE'] },
      ],
    }),
  )
  assert.deepEqual(await createSafeBrowsingChecker('k', { fetch: fn })('https://evil.example/'), {
    status: 'unsafe',
    threats: ['SOCIAL_ENGINEERING', 'MALWARE'],
  })
})

test('HTTP errors, network errors and timeouts become status=error', async () => {
  const http = fakeFetch(() => new Response('quota', { status: 429 }))
  assert.deepEqual(await createSafeBrowsingChecker('k', { fetch: http.fn })('https://x.example'), {
    status: 'error',
    error: 'HTTP 429',
  })

  const network = fakeFetch(() => {
    throw new TypeError('fetch failed')
  })
  assert.deepEqual(await createSafeBrowsingChecker('k', { fetch: network.fn })('https://x.example'), {
    status: 'error',
    error: 'fetch failed',
  })

  // 永遠不回應，靠 AbortSignal.timeout 結束
  const hang = fakeFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
      }),
  )
  const started = Date.now()
  const verdict = await createSafeBrowsingChecker('k', { fetch: hang.fn, timeoutMs: 50 })('https://x.example')
  assert.equal(verdict.status, 'error')
  assert.ok(Date.now() - started < 1000)
})

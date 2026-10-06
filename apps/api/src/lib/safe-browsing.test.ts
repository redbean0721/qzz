import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSafeBrowsingChecker, decodeThreatTypes } from './safe-browsing.js'

// Google v5 urls:search 實際回傳的 protobuf（hex），對 testsafebrowsing.appspot.com 的測試頁和 example.com 擷取
const RESPONSES = {
  phishing: '0a310a2c746573747361666562726f7773696e672e61707073706f742e636f6d2f732f7068697368696e672e68746d6c120102120308ac02',
  malware: '0a310a2b746573747361666562726f7773696e672e61707073706f742e636f6d2f732f6d616c776172652e68746d6c12020104120308ac02',
  unwanted: '0a310a2c746573747361666562726f7773696e672e61707073706f742e636f6d2f732f756e77616e7465642e68746d6c120103120308ac02',
  clean: '120308ac02',
}

const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'))
const protobuf = (hex: string) =>
  new Response(bytes(hex), { headers: { 'content-type': 'application/x-protobuf' } })

function fakeFetch(respond: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: URL[] = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push(url)
    return respond(url, init)
  }) as typeof fetch
  return { fn, calls }
}

test('decodes real v5 responses', () => {
  assert.deepEqual(decodeThreatTypes(bytes(RESPONSES.phishing)), ['SOCIAL_ENGINEERING'])
  assert.deepEqual(decodeThreatTypes(bytes(RESPONSES.malware)), ['MALWARE', 'POTENTIALLY_HARMFUL_APPLICATION'])
  assert.deepEqual(decodeThreatTypes(bytes(RESPONSES.unwanted)), ['UNWANTED_SOFTWARE'])
  assert.deepEqual(decodeThreatTypes(bytes(RESPONSES.clean)), [])
  assert.deepEqual(decodeThreatTypes(new Uint8Array()), [])
})

test('decodes unpacked threat types, de-duplicates and ignores UNSPECIFIED', () => {
  // threats { url: "x", threat_types: 1 (unpacked), threat_types: 0, threat_types: 1 } twice
  const threatUrl = [0x0a, 0x01, 0x78, 0x10, 0x01, 0x10, 0x00, 0x10, 0x01]
  const body = new Uint8Array([0x0a, threatUrl.length, ...threatUrl, 0x0a, threatUrl.length, ...threatUrl])
  assert.deepEqual(decodeThreatTypes(body), ['MALWARE'])
})

test('rejects truncated protobuf', () => {
  assert.throws(() => decodeThreatTypes(bytes(RESPONSES.phishing).subarray(0, 20)), /truncated/)
})

test('sends the key and URL to v5 urls:search', async () => {
  const { fn, calls } = fakeFetch(() => protobuf(RESPONSES.clean))
  await createSafeBrowsingChecker('test-key', { fetch: fn })('https://example.com/a?b=c&d=e')

  assert.equal(calls.length, 1)
  assert.equal(calls[0]!.origin + calls[0]!.pathname, 'https://safebrowsing.googleapis.com/v5/urls:search')
  assert.equal(calls[0]!.searchParams.get('key'), 'test-key')
  assert.deepEqual(calls[0]!.searchParams.getAll('urls'), ['https://example.com/a?b=c&d=e'])
})

test('checker maps responses to verdicts', async () => {
  const check = (hex: string) => createSafeBrowsingChecker('k', { fetch: fakeFetch(() => protobuf(hex)).fn })('https://x.example')
  assert.deepEqual(await check(RESPONSES.clean), { status: 'safe' })
  assert.deepEqual(await check(RESPONSES.phishing), { status: 'unsafe', threats: ['SOCIAL_ENGINEERING'] })
  assert.equal((await check(RESPONSES.phishing.slice(0, 40))).status, 'error')
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

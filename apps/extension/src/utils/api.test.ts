import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError, createLink, deleteItem, errorMessage } from './api'

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return respond()
  }) as typeof fetch
  return { fn, calls }
}

test('errorMessage mirrors the website messages', () => {
  const zod = { error: [{ message: '請輸入有效的 http 或 https 網址' }] }
  assert.equal(errorMessage(400, zod, null), '請輸入有效的 http 或 https 網址')
  assert.equal(errorMessage(400, null, null), '輸入的內容有誤')
  assert.equal(errorMessage(429, null, '42'), '操作太頻繁，請 42 秒後再試')
  assert.equal(errorMessage(429, null, null), '操作太頻繁，請稍後再試')
  assert.equal(errorMessage(413, null, null), '內容太大了')
  assert.equal(errorMessage(undefined, null, null), '無法連線到 qzz.tw，請檢查網路')
  assert.equal(errorMessage(502, null, null), '伺服器發生錯誤，請稍後再試')
})

test('createLink posts JSON to /v1/links on the production origin', async () => {
  const body = { code: 'abc1234', shortUrl: 'https://qzz.tw/abc1234', url: 'https://example.com', expiresAt: null, deleteToken: 't' }
  const { fn, calls } = fakeFetch(() => Response.json(body, { status: 201 }))

  assert.deepEqual(await createLink({ url: 'https://example.com', expiresIn: 'never' }, fn), body)
  assert.equal(calls[0]!.url, 'https://qzz.tw/v1/links')
  assert.equal(calls[0]!.init?.method, 'POST')
  assert.equal(new Headers(calls[0]!.init?.headers).get('content-type'), 'application/json')
  assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { url: 'https://example.com', expiresIn: 'never' })
})

test('API errors become ApiError with the user-facing message', async () => {
  const unsafe = fakeFetch(() =>
    Response.json({ error: [{ code: 'unsafe_url', message: '這個網址被 Google 標記為危險網站，無法縮短' }] }, { status: 400 }),
  )
  await assert.rejects(createLink({ url: 'http://evil.example' }, unsafe.fn), (err) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, 400)
    assert.equal(err.message, '這個網址被 Google 標記為危險網站，無法縮短')
    return true
  })

  const offline = fakeFetch(() => {
    throw new TypeError('Failed to fetch')
  })
  await assert.rejects(createLink({ url: 'https://example.com' }, offline.fn), (err) => {
    assert.ok(err instanceof ApiError)
    assert.equal(err.status, undefined)
    return true
  })
})

test('deleteItem sends the token as a Bearer header and accepts 204', async () => {
  const { fn, calls } = fakeFetch(() => new Response(null, { status: 204 }))
  await deleteItem('paste', 'abc1234', 'secret-token', fn)
  assert.equal(calls[0]!.url, 'https://qzz.tw/v1/pastes/abc1234')
  assert.equal(calls[0]!.init?.method, 'DELETE')
  assert.equal(new Headers(calls[0]!.init?.headers).get('authorization'), 'Bearer secret-token')
})

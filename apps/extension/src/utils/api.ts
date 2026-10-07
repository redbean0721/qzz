import type { CreateLinkInput, CreatePasteInput, LinkResponse, PasteResponse } from '@qzz/shared'

export const API_ORIGIN = typeof __API_ORIGIN__ === 'string' ? __API_ORIGIN__ : 'https://qzz.tw'

export class ApiError extends Error {
  constructor(
    readonly status: number | undefined,
    message: string,
  ) {
    super(message)
  }
}

// 跟網站的 apiErrorMessage 同一套規則
export function errorMessage(status: number | undefined, body: unknown, retryAfter: string | null): string {
  switch (status) {
    case 400: {
      const issues = (body as { error?: unknown } | null)?.error
      const first = Array.isArray(issues) ? (issues[0] as { message?: string } | undefined) : undefined
      return first?.message ?? '輸入的內容有誤'
    }
    case 404:
      return '找不到，可能已過期或已被刪除'
    case 413:
      return '內容太大了'
    case 429:
      return retryAfter ? `操作太頻繁，請 ${retryAfter} 秒後再試` : '操作太頻繁，請稍後再試'
    case undefined:
      return '無法連線到 qzz.tw，請檢查網路'
    default:
      return '伺服器發生錯誤，請稍後再試'
  }
}

async function request<T>(path: string, init: RequestInit, doFetch: typeof fetch = fetch): Promise<T> {
  let res: Response
  try {
    res = await doFetch(`${API_ORIGIN}${path}`, init)
  } catch {
    throw new ApiError(undefined, errorMessage(undefined, null, null))
  }

  if (res.ok) {
    return (res.status === 204 ? undefined : await res.json()) as T
  }

  const body: unknown = await res.json().catch(() => null)
  throw new ApiError(res.status, errorMessage(res.status, body, res.headers.get('retry-after')))
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const createLink = (input: CreateLinkInput, doFetch?: typeof fetch) =>
  request<LinkResponse>('/v1/links', json(input), doFetch)

export const createPaste = (input: CreatePasteInput, doFetch?: typeof fetch) =>
  request<PasteResponse>('/v1/pastes', json(input), doFetch)

export const deleteItem = (kind: 'link' | 'paste', code: string, deleteToken: string, doFetch?: typeof fetch) =>
  request<void>(
    `/v1/${kind === 'link' ? 'links' : 'pastes'}/${encodeURIComponent(code)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${deleteToken}` } },
    doFetch,
  )

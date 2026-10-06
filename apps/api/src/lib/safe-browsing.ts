// Google Safe Browsing v5 urls:search：建立短網址前檢查目標網址
// https://developers.google.com/safe-browsing/reference/rest/v5/urls/search
const ENDPOINT = 'https://safebrowsing.googleapis.com/v5/urls:search'

export type UrlVerdict =
  | { status: 'safe' }
  | { status: 'unsafe'; threats: string[] }
  // 查不到結果（逾時、Google 回錯誤）：呼叫端決定要不要放行
  | { status: 'error'; error: string }

export type UrlChecker = (url: string) => Promise<UrlVerdict>

export function createSafeBrowsingChecker(
  apiKey: string,
  opts: { timeoutMs?: number; fetch?: typeof fetch } = {},
): UrlChecker {
  const { timeoutMs = 2000, fetch: doFetch = fetch } = opts

  return async (url) => {
    const params = new URLSearchParams({ key: apiKey, urls: url })
    try {
      const res = await doFetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) {
        return { status: 'error', error: `HTTP ${res.status}` }
      }
      const body = (await res.json()) as { threats?: Array<{ threatTypes?: string[] }> }
      const threats = [...new Set((body.threats ?? []).flatMap((t) => t.threatTypes ?? []))]
      return threats.length > 0 ? { status: 'unsafe', threats } : { status: 'safe' }
    } catch (err) {
      return { status: 'error', error: err instanceof Error ? err.message : String(err) }
    }
  }
}

type FetchErrorLike = {
  statusCode?: number
  data?: { error?: unknown; message?: string }
  response?: { headers: Headers }
}

// 把 $fetch 丟出的錯誤轉成給使用者看的訊息
export function apiErrorMessage(err: unknown): string {
  const { statusCode, data, response } = (err ?? {}) as FetchErrorLike

  switch (statusCode) {
    case 400: {
      // zod issues：取第一則
      const issues = Array.isArray(data?.error) ? (data.error as Array<{ message?: string }>) : []
      return issues[0]?.message ?? '輸入的內容有誤'
    }
    case 413:
      return '內容太大了'
    case 429: {
      const retryAfter = response?.headers.get('retry-after')
      return retryAfter ? `操作太頻繁，請 ${retryAfter} 秒後再試` : '操作太頻繁，請稍後再試'
    }
    case undefined:
      return '無法連線到伺服器，請檢查網路'
    default:
      return '伺服器發生錯誤，請稍後再試'
  }
}

// qzz.tw/<code> → 問 API 這個短碼要轉去哪，把 302 轉給使用者。
// API 回 404 就放行，讓 Nuxt 照常處理（既有頁面或 404 頁）
const SHORT_LINK_PATH = /^\/([0-9A-Za-z]{6,16})$/

// 網站自己的單層頁面，長得像短碼也不去問 API（省一次請求，也避免萬一抽到同名短碼時蓋掉頁面）。
// 新增 6 個字元以上、只有英數字的單層頁面時要加進來
const PAGES = new Set(['privacy', 'report'])

export default defineEventHandler(async (event) => {
  if (event.method !== 'GET' && event.method !== 'HEAD') return

  const match = SHORT_LINK_PATH.exec(getRequestURL(event).pathname)
  if (!match || PAGES.has(match[1]!)) return

  const { apiBase } = useRuntimeConfig(event)
  let res: Response
  try {
    res = await fetch(`${apiBase}/v1/links/${match[1]}`, { redirect: 'manual' })
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' })
  }

  if (res.status === 404) return

  const location = res.headers.get('location')
  if (res.status !== 302 || !location) {
    throw createError({ statusCode: 502, statusMessage: 'Bad Gateway' })
  }

  setResponseHeader(event, 'cache-control', 'no-store')
  return sendRedirect(event, location, 302)
})

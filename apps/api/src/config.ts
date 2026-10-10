function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`)
  }
  return value
}

// 對應 Fastify 的 trustProxy：未設定 = 不信任任何 proxy（直接用連線 IP）；
// 否則填信任的 proxy IP/CIDR（逗號分隔），正式環境填 Caddy 的位址。
// 不接受 true / 層數：前者任何人都能偽造 X-Forwarded-For，後者 Fastify 5 會直接當成不信任
function trustProxyEnv(): false | string {
  const raw = process.env.TRUST_PROXY?.trim()
  if (!raw || raw === 'false') return false
  if (raw === 'true' || /^\d+$/.test(raw)) {
    throw new Error(`TRUST_PROXY must be a list of proxy IPs/CIDRs, got "${raw}"`)
  }
  return raw
}

export const PUBLIC_BASE_URL = requireEnv('PUBLIC_BASE_URL').replace(/\/+$/, '')
export const REDIS_URL = requireEnv('REDIS_URL')
export const TRUST_PROXY = trustProxyEnv()
export const CLEANUP_INTERVAL_MS = intEnv('CLEANUP_INTERVAL_MINUTES', 60) * 60 * 1000
// 選填：沒設定就不檢查短網址的目標（本機開發、測試）
export const SAFE_BROWSING_API_KEY = process.env.SAFE_BROWSING_API_KEY || undefined

// 每個 IP 每分鐘的上限
export type RateLimits = {
  createLink: number
  createPaste: number
  delete: number
  report: number
  ogImage: number
  linkPreview: number
}

export const RATE_LIMITS: RateLimits = {
  createLink: intEnv('RATE_LIMIT_CREATE_LINK', 10),
  createPaste: intEnv('RATE_LIMIT_CREATE_PASTE', 5),
  delete: intEnv('RATE_LIMIT_DELETE', 20),
  report: intEnv('RATE_LIMIT_REPORT', 5),
  // 貼文預覽圖：Discord 等服務的爬蟲共用少數 IP，所以給高一點；前面有 Cloudflare 快取
  ogImage: intEnv('RATE_LIMIT_OG_IMAGE', 60),
  // 短網址預覽頁的網站卡片（會讓伺服器對外連線）
  linkPreview: intEnv('RATE_LIMIT_LINK_PREVIEW', 30),
}

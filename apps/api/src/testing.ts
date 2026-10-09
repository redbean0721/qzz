import { randomUUID } from 'node:crypto'
import { buildApp, type AppOptions } from './app.js'

const HIGH_LIMIT = 10_000

// 每個 app 用獨立的 rate limit 前綴，避免測試之間（或和 dev server）互相吃額度；
// 預設上限設很高，只有專測 rate limit 的測試才傳低上限。
// 定期清除和 Safe Browsing 預設關閉（.env 有 key 時也不會在測試裡打 Google）
export function buildTestApp(opts: AppOptions = {}) {
  return buildApp({
    cleanup: false,
    urlChecker: false,
    ...opts,
    rateLimit: {
      nameSpace: `qzz:test:${randomUUID()}:`,
      ...opts.rateLimit,
      limits: {
        createLink: HIGH_LIMIT,
        createPaste: HIGH_LIMIT,
        delete: HIGH_LIMIT,
        report: HIGH_LIMIT,
        ogImage: HIGH_LIMIT,
        ...opts.rateLimit?.limits,
      },
    },
  })
}

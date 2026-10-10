import Fastify, { type FastifyServerOptions } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { sql } from 'drizzle-orm'
import { Redis } from 'ioredis'
import {
  CLEANUP_INTERVAL_MS,
  RATE_LIMITS,
  REDIS_URL,
  SAFE_BROWSING_API_KEY,
  type RateLimits,
} from './config.js'
import { db, pool } from './db/index.js'
import { startCleanupScheduler } from './jobs/cleanup.js'
import { createPreviewFetcher, type PreviewFetcher } from './lib/link-preview.js'
import { createPreviewCache } from './lib/preview-cache.js'
import { createSafeBrowsingChecker, type UrlChecker } from './lib/safe-browsing.js'
import { withYouTubeEmbed } from './lib/youtube.js'
import { linkRoutes } from './routes/links.js'
import { pasteRoutes } from './routes/pastes.js'
import { reportRoutes } from './routes/reports.js'

export type AppOptions = {
  fastify?: FastifyServerOptions
  redisUrl?: string
  rateLimit?: {
    nameSpace?: string
    limits?: Partial<RateLimits>
  }
  // false = 不跑定期清除（測試用）
  cleanup?: false | { intervalMs?: number; lockKey?: string }
  // 檢查短網址目標的函式；預設用 SAFE_BROWSING_API_KEY，false = 不檢查（測試用）
  urlChecker?: UrlChecker | false
  // 短網址預覽頁的網站卡片：抓目的地網頁的函式（測試換成假的）和 Valkey 快取的前綴
  linkPreview?: { fetch?: PreviewFetcher; cachePrefix?: string }
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify(opts.fastify)

  // 預設值不適合 rate limit：Valkey 掛掉時要快速失敗，讓 skipOnError 放行
  const redis = new Redis(opts.redisUrl ?? REDIS_URL, {
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
  })
  redis.on('error', (err) => app.log.warn({ err }, 'valkey connection error'))

  let stopCleanup: (() => Promise<void>) | undefined
  if (opts.cleanup !== false) {
    const { intervalMs = CLEANUP_INTERVAL_MS, lockKey = 'qzz:lock:cleanup' } = opts.cleanup ?? {}
    app.addHook('onReady', async () => {
      stopCleanup = startCleanupScheduler({ redis, log: app.log, intervalMs, lockKey })
    })
  }

  // pool 是 module 層級共用的；同一個 process 建多個 app（測試）時只關一次
  app.addHook('onClose', async () => {
    await stopCleanup?.()
    redis.disconnect()
    if (!pool.ending) await pool.end()
  })

  // 5xx 只記 log，不把內部訊息（例如 drizzle 錯誤裡的 SQL 和參數）回給 client
  app.setErrorHandler((err, request, reply) => {
    const statusCode = (err as { statusCode?: number }).statusCode ?? 500
    if (statusCode >= 500) {
      request.log.error(err)
      return reply.code(statusCode).send({ error: 'internal server error' })
    }
    return reply.send(err)
  })

  // 只限制有設定 config.rateLimit 的路由；Valkey 不可用時放行（fail open）
  await app.register(rateLimit, {
    global: false,
    redis,
    nameSpace: opts.rateLimit?.nameSpace ?? 'qzz:rl:',
    skipOnError: true,
  })

  // k8s readiness probe 每 10 秒打一次：不記一般的請求 log，出錯時（warn 以上）照樣記
  app.get('/health', { logLevel: 'warn' }, async () => {
    await db.execute(sql`select 1`)
    return { ok: true, db: 'up' }
  })

  const rateLimits = { ...RATE_LIMITS, ...opts.rateLimit?.limits }
  const urlChecker =
    opts.urlChecker === false
      ? undefined
      : (opts.urlChecker ?? (SAFE_BROWSING_API_KEY ? createSafeBrowsingChecker(SAFE_BROWSING_API_KEY) : undefined))
  if (opts.urlChecker === undefined && !SAFE_BROWSING_API_KEY) {
    app.log.warn('SAFE_BROWSING_API_KEY is not set: short link targets are not checked')
  }

  // 快取的是 LinkPreview 整包 JSON：欄位有增減時把版本往上加，舊格式的快取就不會再被讀到（放著等它過期）
  const linkPreview = createPreviewCache(
    opts.linkPreview?.fetch ?? withYouTubeEmbed(createPreviewFetcher()),
    redis,
    opts.linkPreview?.cachePrefix ?? 'qzz:preview:v3:',
  )

  await app.register(linkRoutes, { rateLimits, urlChecker, linkPreview })
  await app.register(pasteRoutes, { rateLimits })
  await app.register(reportRoutes, { rateLimits })

  return app
}

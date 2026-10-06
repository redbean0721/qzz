import Fastify, { type FastifyServerOptions } from 'fastify'
import rateLimit from '@fastify/rate-limit'
import { sql } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { CLEANUP_INTERVAL_MS, RATE_LIMITS, REDIS_URL, type RateLimits } from './config.js'
import { db, pool } from './db/index.js'
import { startCleanupScheduler } from './jobs/cleanup.js'
import { linkRoutes } from './routes/links.js'
import { pasteRoutes } from './routes/pastes.js'

export type AppOptions = {
  fastify?: FastifyServerOptions
  redisUrl?: string
  rateLimit?: {
    nameSpace?: string
    limits?: Partial<RateLimits>
  }
  // false = 不跑定期清除（測試用）
  cleanup?: false | { intervalMs?: number; lockKey?: string }
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

  app.get('/health', async () => {
    await db.execute(sql`select 1`)
    return { ok: true, db: 'up' }
  })

  const rateLimits = { ...RATE_LIMITS, ...opts.rateLimit?.limits }
  await app.register(linkRoutes, { rateLimits })
  await app.register(pasteRoutes, { rateLimits })

  return app
}

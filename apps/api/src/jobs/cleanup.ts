import type { FastifyBaseLogger } from 'fastify'
import { sql } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { db, schema } from '../db/index.js'
import { runWithLock, startInterval } from './scheduler.js'

const DEFAULT_BATCH_SIZE = 1000
const LOCK_TTL_MS = 10 * 60 * 1000

export type CleanupResult = { links: number; pastes: number }

// 分批刪，避免一次刪大量資料時長時間鎖表；過期就刪，包含 disabled 的
export async function deleteExpired(
  table: typeof schema.links | typeof schema.pastes,
  batchSize: number = DEFAULT_BATCH_SIZE,
): Promise<number> {
  let total = 0
  for (;;) {
    const result = await db.execute(sql`
      delete from ${table}
      where ${table.id} in (
        select ${table.id} from ${table}
        where ${table.expiresAt} <= now()
        limit ${batchSize}
      )
    `)
    const deleted = result.rowCount ?? 0
    total += deleted
    if (deleted < batchSize) return total
  }
}

export async function cleanupExpired(batchSize?: number): Promise<CleanupResult> {
  return {
    links: await deleteExpired(schema.links, batchSize),
    pastes: await deleteExpired(schema.pastes, batchSize),
  }
}

// 多個 API 實例同時跑時只讓一個執行；拿不到鎖（或 Valkey 不可用）就跳過這一輪，回傳 null
export function runCleanupWithLock(
  redis: Redis,
  opts: { lockKey: string; batchSize?: number },
): Promise<CleanupResult | null> {
  return runWithLock(redis, opts.lockKey, LOCK_TTL_MS, () => cleanupExpired(opts.batchSize))
}

export type CleanupSchedulerOptions = {
  redis: Redis
  log: FastifyBaseLogger
  intervalMs: number
  lockKey: string
}

// 啟動時先跑一次，之後每 intervalMs 跑一次；回傳的 stop 會等跑到一半的那輪結束
export function startCleanupScheduler(opts: CleanupSchedulerOptions): () => Promise<void> {
  return startInterval(opts.intervalMs, async () => {
    try {
      const result = await runCleanupWithLock(opts.redis, { lockKey: opts.lockKey })
      if (result === null) {
        opts.log.debug('cleanup skipped: lock held by another instance')
      } else if (result.links > 0 || result.pastes > 0) {
        opts.log.info(result, 'deleted expired rows')
      }
    } catch (err) {
      opts.log.error({ err }, 'cleanup failed')
    }
  })
}

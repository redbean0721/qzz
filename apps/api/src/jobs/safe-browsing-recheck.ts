import type { FastifyBaseLogger } from 'fastify'
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import type { Redis } from 'ioredis'
import { db, schema } from '../db/index.js'
import type { BatchChecker } from '../lib/safe-browsing.js'
import { runWithLock, startInterval } from './scheduler.js'

// 定期用 Safe Browsing 重新檢查短網址的目標：建立時沒問題的網址，之後可能被換成釣魚頁、被 Google 標記。
// 被標記就自動下架（跟建立時被擋的標準一樣），記下威脅類型並把它的檢舉標成已處理。
// 管理員手動恢復（admin enable）的不再檢查，因為 safe_browsing_threats 還留著。
// 越新的短網址越常檢查：建立 1 天內每小時、7 天內每 6 小時、之後每天。每輪最多 RECHECK_LIMIT 筆，
// 每 50 個網址一個請求，控制 Google 的用量

const { links, reports } = schema

export const RECHECK_LIMIT = 1000
const LOCK_TTL_MS = 10 * 60 * 1000

const due = sql`(${links.checkedAt} is null or ${links.checkedAt} < now() - case
  when ${links.createdAt} > now() - interval '1 day' then interval '1 hour'
  when ${links.createdAt} > now() - interval '7 days' then interval '6 hours'
  else interval '1 day'
end)`

export type RecheckResult = {
  /** 這輪檢查沒問題的短網址數 */
  safe: number
  /** 被標記、已自動下架的短網址 */
  disabled: Array<{ code: string; url: string; threats: string[] }>
  /** 查詢失敗、留到下一輪的短網址數 */
  failed: number
  error?: string
}

export async function recheckLinks(check: BatchChecker, { limit = RECHECK_LIMIT } = {}): Promise<RecheckResult> {
  const rows = await db
    .select({ id: links.id, code: links.code, url: links.url })
    .from(links)
    .where(
      and(
        eq(links.disabled, false),
        isNull(links.safeBrowsingThreats),
        or(isNull(links.expiresAt), gt(links.expiresAt, sql`now()`)),
        due,
      ),
    )
    .orderBy(sql`${links.checkedAt} asc nulls first`, asc(links.id))
    .limit(limit)
  if (rows.length === 0) return { safe: 0, disabled: [], failed: 0 }

  // 很多短網址指向同一個網址，每個網址只查一次
  const verdicts = await check([...new Set(rows.map((row) => row.url))])
  const safeIds: number[] = []
  const unsafe = new Map<string, string[]>()
  let failed = 0
  let error: string | undefined
  for (const row of rows) {
    const verdict = verdicts.get(row.url)
    if (verdict?.status === 'safe') safeIds.push(row.id)
    else if (verdict?.status === 'unsafe') unsafe.set(row.url, verdict.threats)
    else {
      failed++
      error ??= verdict?.error ?? 'no verdict'
    }
  }

  if (safeIds.length > 0) {
    await db.update(links).set({ checkedAt: sql`now()` }).where(inArray(links.id, safeIds))
  }

  const disabled: RecheckResult['disabled'] = []
  if (unsafe.size > 0) {
    await db.transaction(async (tx) => {
      const ids: number[] = []
      for (const [url, threats] of unsafe) {
        const taken = await tx
          .update(links)
          .set({ disabled: true, safeBrowsingThreats: threats, checkedAt: sql`now()` })
          .where(
            and(
              inArray(links.id, rows.filter((row) => row.url === url).map((row) => row.id)),
              eq(links.disabled, false),
              isNull(links.safeBrowsingThreats),
            ),
          )
          .returning({ id: links.id, code: links.code })
        ids.push(...taken.map((row) => row.id))
        disabled.push(...taken.map((row) => ({ code: row.code, url, threats })))
      }
      if (ids.length > 0) {
        await tx
          .update(reports)
          .set({ resolvedAt: sql`now()` })
          .where(and(isNull(reports.resolvedAt), inArray(reports.linkId, ids)))
      }
    })
  }

  return { safe: safeIds.length, disabled, failed, ...(error && { error }) }
}

export type RecheckSchedulerOptions = {
  redis: Redis
  log: FastifyBaseLogger
  check: BatchChecker
  intervalMs: number
  lockKey: string
}

export function startRecheckScheduler(opts: RecheckSchedulerOptions): () => Promise<void> {
  return startInterval(opts.intervalMs, async () => {
    try {
      const result = await runWithLock(opts.redis, opts.lockKey, LOCK_TTL_MS, () => recheckLinks(opts.check))
      if (result === null) {
        opts.log.debug('safe browsing recheck skipped: lock held by another instance')
        return
      }
      for (const link of result.disabled) {
        opts.log.warn(link, 'link disabled: target flagged by Safe Browsing')
      }
      if (result.failed > 0) {
        opts.log.warn({ failed: result.failed, err: result.error }, 'safe browsing recheck failed for some links')
      }
      if (result.safe > 0) opts.log.debug({ safe: result.safe }, 'safe browsing recheck')
    } catch (err) {
      opts.log.error({ err }, 'safe browsing recheck failed')
    }
  })
}

import type { FastifyPluginAsync } from 'fastify'
import { createReportSchema } from '@qzz/shared'
import { db, schema } from '../db/index.js'
import { isForeignKeyViolation } from '../lib/db-errors.js'
import { perMinute, type RateLimitedRouteOptions } from '../lib/rate-limit.js'
import { findReportTarget } from '../lib/reports.js'

const { reports } = schema

export const reportRoutes: FastifyPluginAsync<RateLimitedRouteOptions> = async (app, { rateLimits }) => {
  const createOpts = { config: perMinute(rateLimits.report) }

  // 檢舉只記錄下來，由管理員用 admin reports 檢視、決定是否下架（不會自動下架）
  app.post('/v1/reports', createOpts, async (request, reply) => {
    const result = createReportSchema.safeParse(request.body)

    if (!result.success) {
      return reply.code(400).send({ error: result.error.issues })
    }

    const { kind, code, reason, details } = result.data
    const target = await findReportTarget({ kind, code })

    // 不存在、過期都回 404，讓使用者知道網址可能貼錯
    if (!target) {
      return reply.code(404).send({ error: 'not found' })
    }

    // 已下架的不用再記；同一個 IP 重複檢舉同一筆（還沒處理的）也不重複記。回應都一樣
    if (!target.disabled) {
      try {
        const inserted = await db
          .insert(reports)
          .values({
            linkId: kind === 'link' ? target.id : null,
            pasteId: kind === 'paste' ? target.id : null,
            reason,
            details: details || null,
            reporterIp: request.ip,
          })
          .onConflictDoNothing()
          .returning({ id: reports.id })
        if (inserted.length > 0) request.log.warn({ kind, code, reason }, 'content reported')
      } catch (err) {
        // 查到之後剛好被刪除或過期清除
        if (isForeignKeyViolation(err)) return reply.code(404).send({ error: 'not found' })
        throw err
      }
    }

    return reply.code(204).send()
  })
}

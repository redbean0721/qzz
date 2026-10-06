import type { FastifyPluginAsync } from 'fastify'
import { createLinkSchema, type LinkResponse } from '@qzz/shared'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { PUBLIC_BASE_URL } from '../config.js'
import { db, schema } from '../db/index.js'
import { bearerToken } from '../lib/auth.js'
import { CODE_PATTERN, insertWithUniqueCode } from '../lib/code.js'
import { expiresAtFrom } from '../lib/expires.js'
import { perMinute, type RateLimitedRouteOptions } from '../lib/rate-limit.js'
import { generateDeleteToken, hashDeleteToken, verifyDeleteToken } from '../lib/token.js'

const { links } = schema

type CodeParams = { code: string }

export const linkRoutes: FastifyPluginAsync<RateLimitedRouteOptions> = async (app, { rateLimits }) => {
  const createOpts = { config: perMinute(rateLimits.createLink) }
  const deleteOpts = { config: perMinute(rateLimits.delete) }

  app.post('/v1/links', createOpts, async (request, reply) => {
    const result = createLinkSchema.safeParse(request.body)

    if (!result.success) {
      return reply.code(400).send({ error: result.error.issues })
    }

    const { url, expiresIn } = result.data
    const deleteToken = generateDeleteToken()
    const expiresAt = expiresAtFrom(expiresIn)

    const code = await insertWithUniqueCode(
      'links_code_unique',
      (code) =>
        db.insert(links).values({
          code,
          url,
          deleteTokenHash: hashDeleteToken(deleteToken),
          creatorIp: request.ip,
          expiresAt,
        }),
      (code, attempt) => request.log.warn({ code, attempt }, 'short code collision, retrying'),
    )

    const body: LinkResponse = {
      code,
      shortUrl: `${PUBLIC_BASE_URL}/${code}`,
      url,
      expiresAt: expiresAt?.toISOString() ?? null,
      deleteToken,
    }
    return reply.code(201).send(body)
  })

  // qzz.tw/<code> 由前端的 Cloudflare Worker 轉呼叫這條，再把 302 原樣回給使用者
  app.get<{ Params: CodeParams }>('/v1/links/:code', async (request, reply) => {
    const { code } = request.params
    if (!CODE_PATTERN.test(code)) {
      return reply.code(404).send({ error: 'not found' })
    }

    const [link] = await db
      .select({ url: links.url })
      .from(links)
      .where(
        and(
          eq(links.code, code),
          eq(links.disabled, false),
          or(isNull(links.expiresAt), gt(links.expiresAt, sql`now()`)),
        ),
      )
      .limit(1)

    if (!link) {
      return reply.code(404).send({ error: 'not found' })
    }

    // 302 而非 301：瀏覽器不會永久快取，下架後才會生效
    return reply.header('cache-control', 'no-store').redirect(link.url, 302)
  })

  app.delete<{ Params: CodeParams }>('/v1/links/:code', deleteOpts, async (request, reply) => {
    const { code } = request.params
    const token = bearerToken(request)

    if (!token) {
      return reply.code(401).send({ error: 'missing delete token' })
    }

    const [link] = CODE_PATTERN.test(code)
      ? await db
          .select({ id: links.id, deleteTokenHash: links.deleteTokenHash })
          .from(links)
          .where(eq(links.code, code))
          .limit(1)
      : []

    // code 不存在和 token 錯誤都回 404，避免被拿來探測哪些 code 存在
    if (!link || !verifyDeleteToken(token, link.deleteTokenHash)) {
      return reply.code(404).send({ error: 'not found' })
    }

    await db.delete(links).where(eq(links.id, link.id))
    return reply.code(204).send()
  })
}

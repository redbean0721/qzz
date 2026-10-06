import type { FastifyPluginAsync } from 'fastify'
import { createLinkSchema, type LinkResponse } from '@qzz/shared'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { generateCode } from '../lib/code.js'
import { isUniqueViolation } from '../lib/db-errors.js'
import { expiresAtFrom } from '../lib/expires.js'
import { generateDeleteToken, hashDeleteToken, verifyDeleteToken } from '../lib/token.js'

const { links } = schema

if (!process.env.PUBLIC_BASE_URL) {
  throw new Error('PUBLIC_BASE_URL is not set')
}

const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL.replace(/\/+$/, '')
const MAX_CODE_ATTEMPTS = 5
const CODE_PATTERN = /^[0-9A-Za-z]{1,16}$/

type CodeParams = { code: string }

export const linkRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/links', async (request, reply) => {
    const result = createLinkSchema.safeParse(request.body)

    if (!result.success) {
      return reply.code(400).send({ error: result.error.issues })
    }

    const { url, expiresIn } = result.data
    const deleteToken = generateDeleteToken()
    const expiresAt = expiresAtFrom(expiresIn)

    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
      const code = generateCode()
      try {
        await db.insert(links).values({
          code,
          url,
          deleteTokenHash: hashDeleteToken(deleteToken),
          creatorIp: request.ip,
          expiresAt,
        })
      } catch (err) {
        if (isUniqueViolation(err, 'links_code_unique')) {
          request.log.warn({ code, attempt }, 'short code collision, retrying')
          continue
        }
        throw err
      }

      const body: LinkResponse = {
        code,
        shortUrl: `${PUBLIC_BASE_URL}/${code}`,
        url,
        expiresAt: expiresAt?.toISOString() ?? null,
        deleteToken,
      }
      return reply.code(201).send(body)
    }

    throw new Error(`failed to allocate a unique short code after ${MAX_CODE_ATTEMPTS} attempts`)
  })

  app.get<{ Params: CodeParams }>('/:code', async (request, reply) => {
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

  app.delete<{ Params: CodeParams }>('/api/links/:code', async (request, reply) => {
    const { code } = request.params
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1]

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

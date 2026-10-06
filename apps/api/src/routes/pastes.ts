import type { FastifyPluginAsync } from 'fastify'
import {
  MAX_PASTE_BYTES,
  createPasteSchema,
  type PasteResponse,
  type PasteView,
} from '@qzz/shared'
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { PUBLIC_BASE_URL } from '../config.js'
import { db, schema } from '../db/index.js'
import { bearerToken } from '../lib/auth.js'
import { CODE_PATTERN, insertWithUniqueCode } from '../lib/code.js'
import { expiresAtFrom } from '../lib/expires.js'
import { perMinute, type RateLimitedRouteOptions } from '../lib/rate-limit.js'
import { generateDeleteToken, hashDeleteToken, verifyDeleteToken } from '../lib/token.js'

const { pastes } = schema

// JSON 跳脫最壞情況是每個 byte 變成 \u00XX（6 bytes），再留一點給其他欄位
const PASTE_BODY_LIMIT = MAX_PASTE_BYTES * 6 + 64 * 1024

type CodeParams = { code: string }

async function findActivePaste(code: string) {
  if (!CODE_PATTERN.test(code)) return undefined

  const [paste] = await db
    .select({
      code: pastes.code,
      content: pastes.content,
      language: pastes.language,
      createdAt: pastes.createdAt,
      expiresAt: pastes.expiresAt,
    })
    .from(pastes)
    .where(
      and(
        eq(pastes.code, code),
        eq(pastes.disabled, false),
        or(isNull(pastes.expiresAt), gt(pastes.expiresAt, sql`now()`)),
      ),
    )
    .limit(1)

  return paste
}

export const pasteRoutes: FastifyPluginAsync<RateLimitedRouteOptions> = async (app, { rateLimits }) => {
  const createOpts = { bodyLimit: PASTE_BODY_LIMIT, config: perMinute(rateLimits.createPaste) }
  const deleteOpts = { config: perMinute(rateLimits.delete) }

  app.post('/v1/pastes', createOpts, async (request, reply) => {
    const result = createPasteSchema.safeParse(request.body)

    if (!result.success) {
      return reply.code(400).send({ error: result.error.issues })
    }

    const { content, language, expiresIn } = result.data
    const deleteToken = generateDeleteToken()
    const expiresAt = expiresAtFrom(expiresIn)

    const code = await insertWithUniqueCode(
      'pastes_code_unique',
      (code) =>
        db.insert(pastes).values({
          code,
          content,
          language,
          deleteTokenHash: hashDeleteToken(deleteToken),
          creatorIp: request.ip,
          expiresAt,
        }),
      (code, attempt) => request.log.warn({ code, attempt }, 'short code collision, retrying'),
    )

    const body: PasteResponse = {
      code,
      url: `${PUBLIC_BASE_URL}/p/${code}`,
      rawUrl: `${PUBLIC_BASE_URL}/v1/pastes/${code}/raw`,
      expiresAt: expiresAt?.toISOString() ?? null,
      deleteToken,
    }
    return reply.code(201).send(body)
  })

  app.get<{ Params: CodeParams }>('/v1/pastes/:code', async (request, reply) => {
    const paste = await findActivePaste(request.params.code)

    if (!paste) {
      return reply.code(404).send({ error: 'not found' })
    }

    const body: PasteView = {
      code: paste.code,
      content: paste.content,
      language: paste.language,
      createdAt: paste.createdAt.toISOString(),
      expiresAt: paste.expiresAt?.toISOString() ?? null,
    }
    return reply.header('cache-control', 'no-store').send(body)
  })

  app.get<{ Params: CodeParams }>('/v1/pastes/:code/raw', async (request, reply) => {
    const paste = await findActivePaste(request.params.code)

    if (!paste) {
      return reply.code(404).type('text/plain; charset=utf-8').send('not found\n')
    }

    // 使用者內容一律當純文字，禁止瀏覽器猜測型別或執行任何東西
    return reply
      .type('text/plain; charset=utf-8')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox")
      .header('cache-control', 'no-store')
      .send(paste.content)
  })

  app.delete<{ Params: CodeParams }>('/v1/pastes/:code', deleteOpts, async (request, reply) => {
    const { code } = request.params
    const token = bearerToken(request)

    if (!token) {
      return reply.code(401).send({ error: 'missing delete token' })
    }

    const [paste] = CODE_PATTERN.test(code)
      ? await db
          .select({ id: pastes.id, deleteTokenHash: pastes.deleteTokenHash })
          .from(pastes)
          .where(eq(pastes.code, code))
          .limit(1)
      : []

    // code 不存在和 token 錯誤都回 404，避免被拿來探測哪些 code 存在
    if (!paste || !verifyDeleteToken(token, paste.deleteTokenHash)) {
      return reply.code(404).send({ error: 'not found' })
    }

    await db.delete(pastes).where(eq(pastes.id, paste.id))
    return reply.code(204).send()
  })
}

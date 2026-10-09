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
import { renderPasteImage } from '../lib/og-image.js'
import { perMinute, type RateLimitedRouteOptions } from '../lib/rate-limit.js'
import { generateDeleteToken, hashDeleteToken, verifyDeleteToken } from '../lib/token.js'

const { pastes } = schema

// JSON 跳脫最壞情況是每個 byte 變成 \u00XX（6 bytes），再留一點給其他欄位
const PASTE_BODY_LIMIT = MAX_PASTE_BYTES * 6 + 64 * 1024

// 預覽圖上顯示的網域
const PUBLIC_HOST = new URL(PUBLIC_BASE_URL).host
// Cloudflare 和這裡的記憶體都快取 10 分鐘：下架後最久 10 分鐘還拿得到舊圖（Discord 自己也會快取，那部分管不到）
const OG_IMAGE_MAX_AGE = 600
const OG_IMAGE_CACHE_SIZE = 50

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
  const ogImageOpts = { config: perMinute(rateLimits.ogImage) }

  // 最近畫過的圖（code → PNG 和產生時間）：加上 query string 繞過 Cloudflare 快取時也不用重畫
  const ogImages = new Map<string, { png: Buffer; at: number }>()

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
      .header('x-robots-tag', 'noindex, nofollow')
      .send(paste.content)
  })

  // og:image：Discord 等服務顯示的預覽圖，畫出貼文開頭幾行
  app.get<{ Params: CodeParams }>('/v1/pastes/:code/og.png', ogImageOpts, async (request, reply) => {
    // 每次都查資料庫，下架、刪除、過期後這裡立刻 404
    const paste = await findActivePaste(request.params.code)

    if (!paste) {
      ogImages.delete(request.params.code)
      return reply.code(404).header('cache-control', 'no-store').type('text/plain; charset=utf-8').send('not found\n')
    }

    let cached = ogImages.get(paste.code)
    if (!cached || Date.now() - cached.at > OG_IMAGE_MAX_AGE * 1000) {
      const png = await renderPasteImage({
        code: paste.code,
        host: PUBLIC_HOST,
        content: paste.content,
        language: paste.language,
      })
      cached = { png, at: Date.now() }
      ogImages.delete(paste.code)
      ogImages.set(paste.code, cached)
      // Map 依加入順序，超過上限就丟掉最舊的
      if (ogImages.size > OG_IMAGE_CACHE_SIZE) ogImages.delete(ogImages.keys().next().value!)
    }

    return reply
      .type('image/png')
      .header('cache-control', `public, max-age=${OG_IMAGE_MAX_AGE}`)
      .header('x-content-type-options', 'nosniff')
      .header('x-robots-tag', 'noindex')
      .send(cached.png)
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

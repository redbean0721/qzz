import Fastify, { type FastifyServerOptions } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, pool } from './db/index.js'
import { linkRoutes } from './routes/links.js'
import { pasteRoutes } from './routes/pastes.js'

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts)

  app.addHook('onClose', async () => {
    await pool.end()
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

  app.get('/health', async () => {
    await db.execute(sql`select 1`)
    return { ok: true, db: 'up' }
  })

  await app.register(linkRoutes)
  await app.register(pasteRoutes)

  return app
}

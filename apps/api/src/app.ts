import Fastify, { type FastifyServerOptions } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, pool } from './db/index.js'
import { linkRoutes } from './routes/links.js'

export async function buildApp(opts: FastifyServerOptions = {}) {
  const app = Fastify(opts)

  app.addHook('onClose', async () => {
    await pool.end()
  })

  app.get('/health', async () => {
    await db.execute(sql`select 1`)
    return { ok: true, db: 'up' }
  })

  await app.register(linkRoutes)

  return app
}

import Fastify from 'fastify'
import { createLinkSchema } from '@qzz/shared'

const app = Fastify({
  logger: process.env.NODE_ENV === 'production'
    ? true
    : { transport: { target: 'pino-pretty' } },
})

app.get('/health', async () => {
  return { ok: true }
})

app.post('/api/links', async (request, reply) => {
  const result = createLinkSchema.safeParse(request.body)

  if (!result.success) {
    return reply.code(400).send({ error: result.error.issues })
  }

  // 之後接資料庫，現在先回傳收到的內容
  return { received: result.data }
})

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

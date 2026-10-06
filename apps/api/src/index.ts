import Fastify from 'fastify'

const app = Fastify({
  logger: process.env.NODE_ENV === 'production'
    ? true
    : { transport: { target: 'pino-pretty' } },
})

app.get('/health', async () => {
  return { ok: true }
})

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

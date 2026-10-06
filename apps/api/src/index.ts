import { buildApp } from './app.js'
import { TRUST_PROXY } from './config.js'

const app = await buildApp({
  fastify: {
    logger: process.env.NODE_ENV === 'production'
      ? true
      : { transport: { target: 'pino-pretty' } },
    trustProxy: TRUST_PROXY,
  },
})

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

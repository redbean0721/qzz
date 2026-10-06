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

// k8s 滾動更新會送 SIGTERM：停止接新連線、等進行中的請求和清除排程結束，再關 DB / Valkey
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down')
    try {
      await app.close()
      process.exit(0)
    } catch (err) {
      app.log.error(err)
      process.exit(1)
    }
  })
}

try {
  await app.listen({ port, host })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

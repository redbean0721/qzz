// 套用 drizzle/ 裡的 migration：正式環境由 k8s initContainer 執行 node dist/migrate.js
// （drizzle-kit 是 devDependency，不在正式 image 裡）
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set')
}

// 多個 Pod 同時啟動時只讓一個跑 migration，其他的等它結束（advisory lock 綁在這條連線上）
const LOCK_KEY = 0x717a7a // 'qzz'

// src/migrate.ts 和 dist/migrate.js 都在 drizzle/ 的隔壁目錄
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()

try {
  await client.query('select pg_advisory_lock($1)', [LOCK_KEY])
  await migrate(drizzle({ client }), { migrationsFolder })
  console.log('migrations applied')
} finally {
  await client.end()
}

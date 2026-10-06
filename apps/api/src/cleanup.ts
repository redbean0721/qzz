// 手動清除過期資料：yarn workspace @qzz/api cleanup（正式環境用 node dist/cleanup.js）
// 不拿 Valkey 鎖；重複刪除是安全的，只是多做一次
import { pool } from './db/index.js'
import { cleanupExpired } from './jobs/cleanup.js'

try {
  const result = await cleanupExpired()
  console.log(`deleted expired rows: links=${result.links} pastes=${result.pastes}`)
} finally {
  await pool.end()
}

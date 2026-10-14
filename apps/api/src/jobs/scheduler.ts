import { randomUUID } from 'node:crypto'
import type { Redis } from 'ioredis'

// 定期工作（過期清除、Safe Browsing 重新檢查）共用：Valkey 鎖讓多個 API 實例只有一個在跑，加上計時器

// 只刪自己拿到的鎖，避免鎖過期後被別的實例取得又被這裡誤刪
const RELEASE_LOCK = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
  end
  return 0
`

/** 拿到鎖才執行；拿不到（別的實例正在跑，或 Valkey 不可用）就跳過，回傳 null */
export async function runWithLock<T>(redis: Redis, lockKey: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const token = randomUUID()
  const acquired = await redis.set(lockKey, token, 'PX', ttlMs, 'NX')
  if (acquired !== 'OK') return null

  try {
    return await fn()
  } finally {
    await redis.eval(RELEASE_LOCK, 1, lockKey, token).catch(() => {})
  }
}

/**
 * 啟動時先跑一次，之後每 intervalMs 跑一次；上一輪還沒跑完就不重疊。
 * run 要自己處理錯誤。回傳的 stop 會等跑到一半的那輪結束
 */
export function startInterval(intervalMs: number, run: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined

  const tick = () => {
    running ??= run().finally(() => {
      running = undefined
    })
  }

  tick()
  const timer = setInterval(tick, intervalMs)
  timer.unref()

  return async () => {
    clearInterval(timer)
    await running
  }
}

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Fastify from 'fastify'
import { inArray } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { REDIS_URL } from '../config.js'
import { db, pool, schema } from '../db/index.js'
import { generateCode } from '../lib/code.js'
import {
  cleanupExpired,
  deleteExpired,
  runCleanupWithLock,
  startCleanupScheduler,
} from './cleanup.js'

// 注意：清除本來就是刪「所有」過期資料，dev DB 裡其他已過期的列也會被刪（它們本來就讀不到）
const { links, pastes } = schema
const redis = new Redis(REDIS_URL)
const created: string[] = []

after(async () => {
  if (created.length > 0) {
    await db.delete(links).where(inArray(links.code, created))
    await db.delete(pastes).where(inArray(pastes.code, created))
  }
  redis.disconnect()
  await pool.end()
})

const past = () => new Date(Date.now() - 60_000)
const future = () => new Date(Date.now() + 3600_000)

async function insertLinks(rows: Array<{ expiresAt: Date | null; disabled?: boolean }>) {
  const codes = rows.map(() => generateCode())
  created.push(...codes)
  await db.insert(links).values(
    rows.map((row, i) => ({ code: codes[i]!, url: 'https://example.com', deleteTokenHash: 'x', ...row })),
  )
  return codes
}

async function insertPaste(expiresAt: Date | null) {
  const code = generateCode()
  created.push(code)
  await db.insert(pastes).values({ code, content: 'x', deleteTokenHash: 'x', expiresAt })
  return code
}

async function existingLinks(codes: string[]) {
  const rows = await db.select({ code: links.code }).from(links).where(inArray(links.code, codes))
  return new Set(rows.map((r) => r.code))
}

test('deleteExpired removes expired rows in batches and keeps the rest', async () => {
  const expired = await insertLinks([
    { expiresAt: past() },
    { expiresAt: past() },
    { expiresAt: past() },
    { expiresAt: past() },
    { expiresAt: past(), disabled: true },
  ])
  const kept = await insertLinks([{ expiresAt: future() }, { expiresAt: null }])

  // batch 2 → 至少要跑 3 輪才刪得完
  const deleted = await deleteExpired(links, 2)
  assert.ok(deleted >= expired.length, `deleted ${deleted}`)

  const remaining = await existingLinks([...expired, ...kept])
  assert.deepEqual([...remaining].sort(), [...kept].sort())
})

test('cleanupExpired covers links and pastes', async () => {
  const [link] = await insertLinks([{ expiresAt: past() }])
  const paste = await insertPaste(past())
  const keptPaste = await insertPaste(null)

  const result = await cleanupExpired()
  assert.ok(result.links >= 1 && result.pastes >= 1)

  assert.equal((await existingLinks([link!])).size, 0)
  const pasteRows = await db.select({ code: pastes.code }).from(pastes).where(inArray(pastes.code, [paste, keptPaste]))
  assert.deepEqual(pasteRows.map((r) => r.code), [keptPaste])
})

test('runCleanupWithLock skips while another instance holds the lock', async () => {
  const lockKey = `qzz:test:lock:${randomUUID()}`
  await redis.set(lockKey, 'other-instance', 'PX', 60_000)
  const [code] = await insertLinks([{ expiresAt: past() }])

  assert.equal(await runCleanupWithLock(redis, { lockKey }), null)
  assert.equal((await existingLinks([code!])).size, 1)
  assert.equal(await redis.get(lockKey), 'other-instance')

  await redis.del(lockKey)
})

test('runCleanupWithLock releases its lock afterwards', async () => {
  const lockKey = `qzz:test:lock:${randomUUID()}`
  const [code] = await insertLinks([{ expiresAt: past() }])

  const result = await runCleanupWithLock(redis, { lockKey })
  assert.ok(result && result.links >= 1)
  assert.equal((await existingLinks([code!])).size, 0)
  assert.equal(await redis.exists(lockKey), 0)
})

test('scheduler runs on start and stop waits for the in-flight run', async () => {
  const [code] = await insertLinks([{ expiresAt: past() }])

  const stop = startCleanupScheduler({
    redis,
    log: Fastify().log,
    intervalMs: 3600_000,
    lockKey: `qzz:test:lock:${randomUUID()}`,
  })
  await stop()

  assert.equal((await existingLinks([code!])).size, 0)
})

import { createHash } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import type { Redis } from 'ioredis'
import type { LinkPreview } from '@qzz/shared'
import { BlockedAddressError, EMPTY_PREVIEW, type PreviewFetcher } from './link-preview.js'

// 同一個目的地 1 小時內只抓一次（多個 Pod 共用 Valkey）；失敗的記 10 分鐘，不要一直重試。
// 同時最多抓 MAX_ACTIVE 個，排隊太多就直接回空的，避免被拿來大量對外發請求
const CACHE_SECONDS = 3600
const FAILURE_CACHE_SECONDS = 600
const MAX_ACTIVE = 4
const MAX_WAITING = 32

export type PreviewCache = (url: string, log: FastifyBaseLogger) => Promise<LinkPreview>

export function createPreviewCache(fetchPreview: PreviewFetcher, redis: Redis, prefix: string): PreviewCache {
  const inFlight = new Map<string, Promise<LinkPreview>>()
  const waiting: Array<() => void> = []
  let active = 0

  async function limited<T>(task: () => Promise<T>): Promise<T | undefined> {
    if (active >= MAX_ACTIVE) {
      if (waiting.length >= MAX_WAITING) return undefined
      await new Promise<void>((resolve) => waiting.push(resolve))
    }
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }

  async function load(url: string, key: string, log: FastifyBaseLogger): Promise<LinkPreview> {
    let preview: LinkPreview
    let seconds = CACHE_SECONDS
    try {
      const result = await limited(() => fetchPreview(url))
      if (!result) return EMPTY_PREVIEW
      preview = result
    } catch (err) {
      // 被擋（內網位址）是預期中的，其他錯誤（逾時、連不上）記一下
      if (!(err instanceof BlockedAddressError)) log.info({ url, err: (err as Error).message }, 'link preview fetch failed')
      preview = EMPTY_PREVIEW
      seconds = FAILURE_CACHE_SECONDS
    }
    await redis.set(key, JSON.stringify(preview), 'EX', seconds).catch(() => {})
    return preview
  }

  return async (url, log) => {
    const key = prefix + createHash('sha256').update(url).digest('hex')
    const cached = await redis.get(key).catch(() => null)
    if (cached) return JSON.parse(cached) as LinkPreview

    let pending = inFlight.get(key)
    if (!pending) {
      pending = load(url, key, log).finally(() => inFlight.delete(key))
      inFlight.set(key, pending)
    }
    return pending
  }
}

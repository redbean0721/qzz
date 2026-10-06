import type { RateLimits } from '../config.js'

export type RateLimitedRouteOptions = { rateLimits: RateLimits }

// 放在 route 的 config 裡，交給 @fastify/rate-limit 處理
export function perMinute(max: number) {
  return { rateLimit: { max, timeWindow: '1 minute' } }
}

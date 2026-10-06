import type { ExpiresIn } from '@qzz/shared'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

const DURATIONS: Record<Exclude<ExpiresIn, 'never'>, number> = {
  '1h': HOUR,
  '1d': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
}

// null = 永久
export function expiresAtFrom(expiresIn: ExpiresIn, now: Date = new Date()): Date | null {
  if (expiresIn === 'never') return null
  return new Date(now.getTime() + DURATIONS[expiresIn])
}

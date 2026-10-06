import { EXPIRES_IN, type ExpiresIn } from '@qzz/shared'

const LABELS: Record<ExpiresIn, string> = {
  '1h': '1 小時',
  '1d': '1 天',
  '7d': '7 天',
  '30d': '30 天',
  never: '永久',
}

export const expiresOptions = EXPIRES_IN.map((value) => ({ label: LABELS[value], value }))

export function isExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= Date.now()
}

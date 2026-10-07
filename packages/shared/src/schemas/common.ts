import { z } from 'zod'

export const EXPIRES_IN = ['1h', '1d', '7d', '30d', 'never'] as const

export const expiresInSchema = z.enum(EXPIRES_IN)
export type ExpiresIn = z.infer<typeof expiresInSchema>

// 網站和擴充功能共用的顯示文字
export const EXPIRES_IN_LABELS: Record<ExpiresIn, string> = {
  '1h': '1 小時',
  '1d': '1 天',
  '7d': '7 天',
  '30d': '30 天',
  never: '永久',
}

import { z } from 'zod'

export const EXPIRES_IN = ['1h', '1d', '7d', '30d', 'never'] as const

export const expiresInSchema = z.enum(EXPIRES_IN)
export type ExpiresIn = z.infer<typeof expiresInSchema>

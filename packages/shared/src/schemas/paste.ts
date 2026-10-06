import { z } from 'zod'
import { expiresInSchema } from './common.js'

export const MAX_PASTE_BYTES = 512 * 1024 // 512 KB

export const createPasteSchema = z.object({
  content: z
    .string()
    .min(1, '內容不可為空')
    .refine(
      (s) => new TextEncoder().encode(s).length <= MAX_PASTE_BYTES,
      `內容不可超過 ${MAX_PASTE_BYTES / 1024} KB`,
    ),
  language: z.string().max(32).optional(),
  expiresIn: expiresInSchema.default('30d'),
})

export type CreatePasteInput = z.input<typeof createPasteSchema>

export const pasteResponseSchema = z.object({
  code: z.string(),
  url: z.string(),
  rawUrl: z.string(),
  expiresAt: z.string().nullable(),
  deleteToken: z.string(),
})

export type PasteResponse = z.infer<typeof pasteResponseSchema>

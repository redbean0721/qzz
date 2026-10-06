import { z } from 'zod'
import { expiresInSchema } from './common.js'

export const createLinkSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
  expiresIn: expiresInSchema.default('never'),
})

export type CreateLinkInput = z.input<typeof createLinkSchema>

export const linkResponseSchema = z.object({
  code: z.string(),
  shortUrl: z.string(),
  url: z.string(),
  expiresAt: z.string().nullable(),
  deleteToken: z.string(),
})

export type LinkResponse = z.infer<typeof linkResponseSchema>

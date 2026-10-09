import { z } from 'zod'
import { expiresInSchema } from './common.js'

export const createLinkSchema = z.object({
  url: z
    .url({ protocol: /^https?$/, error: '請輸入有效的 http 或 https 網址' })
    // z.url() 會像瀏覽器一樣去掉 tab/CR/LF，但 NUL 等其他控制字元會留著：
    // NUL 存不進 Postgres，其餘的也不該出現在 Location header
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), '網址不可包含控制字元'),
  expiresIn: expiresInSchema.default('1d'),
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

// qzz.tw/<code>+ 預覽頁用：不轉址，只回傳目的地
export const linkViewSchema = z.object({
  code: z.string(),
  url: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
})

export type LinkView = z.infer<typeof linkViewSchema>

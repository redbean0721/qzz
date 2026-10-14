import { z } from 'zod'
import { expiresInSchema } from './common.js'

export const MAX_PASTE_BYTES = 512 * 1024 // 512 KB

// 建立貼文時可選的語言，也是語法高亮的白名單；text = 純文字。
// API 只接受這些值，擴充功能從 GET /v1/pastes/languages 讀取（新增語言不用發新版）。
// 只能新增、不要刪除或改名：沒更新的擴充功能（0.1.0 寫死了這份清單）還會送出舊的值
export const PASTE_LANGUAGES = [
  'text', 'bash', 'c', 'cpp', 'css', 'go', 'html', 'java', 'javascript',
  'json', 'markdown', 'python', 'rust', 'sql', 'typescript', 'yaml',
] as const

export const pasteLanguageSchema = z.enum(PASTE_LANGUAGES, { error: '不支援這個語言' })

export const createPasteSchema = z.object({
  content: z
    .string()
    .min(1, '內容不可為空')
    .refine(
      (s) => new TextEncoder().encode(s).length <= MAX_PASTE_BYTES,
      `內容不可超過 ${MAX_PASTE_BYTES / 1024} KB`,
    )
    // Postgres TEXT 不能存 NUL
    .refine((s) => !s.includes('\0'), '內容不可包含 NUL 字元'),
  language: pasteLanguageSchema.optional(),
  expiresIn: expiresInSchema.default('1d'),
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

export const pasteViewSchema = z.object({
  code: z.string(),
  content: z.string(),
  language: z.string().nullable(),
  // 開頭一段的純文字（Markdown 已拿掉格式符號），給 og:description 用
  description: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
})

export type PasteView = z.infer<typeof pasteViewSchema>

// GET /v1/pastes/languages
export const pasteLanguagesResponseSchema = z.object({
  languages: z.array(z.string()),
})

export type PasteLanguagesResponse = z.infer<typeof pasteLanguagesResponseSchema>

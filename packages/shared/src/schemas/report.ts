import { z } from 'zod'

// 檢舉的對象：短網址或貼文
export const CONTENT_KINDS = ['link', 'paste'] as const
export type ContentKind = (typeof CONTENT_KINDS)[number]
export type ContentRef = { kind: ContentKind; code: string }

const CODE = /^[0-9A-Za-z]{1,16}$/

export const REPORT_REASONS = ['phishing', 'malware', 'spam', 'illegal', 'other'] as const
export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  phishing: '釣魚或詐騙',
  malware: '惡意程式或病毒',
  spam: '垃圾訊息或廣告',
  illegal: '違法內容',
  other: '其他',
}

export const MAX_REPORT_DETAILS = 1000

export const createReportSchema = z.object({
  kind: z.enum(CONTENT_KINDS),
  code: z.string().regex(CODE, '代碼格式不正確'),
  reason: z.enum(REPORT_REASONS, { error: '請選擇檢舉原因' }),
  details: z
    .string()
    .trim()
    .max(MAX_REPORT_DETAILS, `補充說明不可超過 ${MAX_REPORT_DETAILS} 字`)
    // 換行和 tab 以外的控制字元（包含 Postgres 存不進去的 NUL）
    .refine((s) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s), '補充說明不可包含控制字元')
    .optional(),
})

export type CreateReportInput = z.input<typeof createReportSchema>

// 把使用者貼上的網址轉成檢舉對象；只接受這個網站（host）的網址，可以省略 https://。
// 支援 /<code>、/p/<code>，以及 API 的 /v1/links/<code>、/v1/pastes/<code>(/raw)
export function parseContentUrl(input: string, host: string): ContentRef | null {
  const text = input.trim()
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.host !== host.toLowerCase()) return null

  const segments = url.pathname.replace(/\/$/, '').split('/').slice(1)
  let ref: ContentRef | null = null
  if (segments.length === 1) ref = { kind: 'link', code: segments[0]! }
  else if (segments.length === 2 && segments[0] === 'p') ref = { kind: 'paste', code: segments[1]! }
  else if (segments[0] === 'v1' && segments[1] === 'links' && segments.length === 3) ref = { kind: 'link', code: segments[2]! }
  else if (
    segments[0] === 'v1' &&
    segments[1] === 'pastes' &&
    (segments.length === 3 || (segments.length === 4 && segments[3] === 'raw'))
  ) {
    ref = { kind: 'paste', code: segments[2]! }
  }

  return ref && CODE.test(ref.code) ? ref : null
}

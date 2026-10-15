import { z } from 'zod'

// 建立過的連結和貼文（含刪除碼），只存在使用者的瀏覽器：網站在 localStorage，擴充功能在 storage.local。
// 擴充功能的 content script 在 qzz.tw 上把兩邊合併（mergeHistory），網站和擴充功能都用這裡的格式和規則

export const MAX_HISTORY_ITEMS = 100
// 永久的項目被刪除後，刪除紀錄保留的時間（另一邊這段時間內同步過就不會再出現）
export const REMOVAL_TTL_MS = 30 * 24 * 60 * 60 * 1000

const isoDate = z.iso.datetime({ offset: true })

export const historyItemSchema = z.object({
  kind: z.enum(['link', 'paste']),
  code: z.string().regex(/^[0-9A-Za-z]{1,16}$/),
  // 短網址或貼文頁網址
  url: z.url({ protocol: /^https?$/ }),
  // 短網址的原始網址（只當文字顯示）
  target: z.string().max(10_000).optional(),
  // 閱後即焚的貼文
  burnAfterReading: z.boolean().optional(),
  deleteToken: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  expiresAt: isoDate.nullable(),
  createdAt: isoDate,
})

export type HistoryItem = z.infer<typeof historyItemSchema>

// 刪除過的項目：合併時另一邊還有它也不會再加回來。用 createdAt 區分同一個代碼被重新發出的新項目
export const historyRemovalSchema = z.object({
  kind: z.enum(['link', 'paste']),
  code: z.string().regex(/^[0-9A-Za-z]{1,16}$/),
  createdAt: isoDate,
  // 過了這個時間就不用再記（項目本身也已過期）
  until: isoDate,
})

export type HistoryRemoval = z.infer<typeof historyRemovalSchema>

export type HistoryState = { items: HistoryItem[]; removed: HistoryRemoval[] }

const keyOf = (item: { kind: string; code: string; createdAt: string }) => `${item.kind}:${item.code}:${item.createdAt}`

export function isExpired(expiresAt: string | null, now = Date.now()): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= now
}

/**
 * 從儲存空間讀到的值：格式不對的項目丟掉（可能是舊版、被改壞，或是網頁上的程式塞進來的）。
 * origin 有給時，url 必須是這個網站的網址
 */
export function parseHistoryItems(value: unknown, origin?: string): HistoryItem[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const parsed = historyItemSchema.safeParse(raw)
    if (!parsed.success) return []
    if (origin !== undefined && !parsed.data.url.startsWith(`${origin}/`)) return []
    return [parsed.data]
  })
}

export function parseHistoryRemovals(value: unknown): HistoryRemoval[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw) => {
    const parsed = historyRemovalSchema.safeParse(raw)
    return parsed.success ? [parsed.data] : []
  })
}

export function removalOf(item: HistoryItem, now = Date.now()): HistoryRemoval {
  return {
    kind: item.kind,
    code: item.code,
    createdAt: item.createdAt,
    until: item.expiresAt ?? new Date(now + REMOVAL_TTL_MS).toISOString(),
  }
}

/**
 * 合併幾份紀錄：項目取聯集（同一個項目兩邊的內容本來就一樣，取先出現的），刪除過的和過期的拿掉，
 * 依建立時間新到舊排序，最多 MAX_HISTORY_ITEMS 筆。重複合併結果不變，所以兩邊可以各自隨時合併
 */
export function mergeHistory(states: HistoryState[], now = Date.now()): HistoryState {
  const removed = new Map<string, HistoryRemoval>()
  for (const removal of states.flatMap((s) => s.removed)) {
    if (Date.parse(removal.until) <= now) continue
    const key = keyOf(removal)
    const existing = removed.get(key)
    if (!existing || removal.until > existing.until) removed.set(key, removal)
  }

  const items = new Map<string, HistoryItem>()
  for (const item of states.flatMap((s) => s.items)) {
    const key = keyOf(item)
    if (removed.has(key) || isExpired(item.expiresAt, now) || items.has(key)) continue
    items.set(key, item)
  }

  const byKey = (a: { kind: string; code: string; createdAt: string }, b: typeof a) =>
    a.createdAt === b.createdAt ? keyOf(a).localeCompare(keyOf(b)) : a.createdAt < b.createdAt ? 1 : -1

  return {
    items: [...items.values()].sort(byKey).slice(0, MAX_HISTORY_ITEMS),
    removed: [...removed.values()].sort(byKey),
  }
}

/** 兩份紀錄內容是否相同（決定要不要寫回儲存空間，避免互相觸發變更通知） */
export function sameHistory(a: HistoryState, b: HistoryState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

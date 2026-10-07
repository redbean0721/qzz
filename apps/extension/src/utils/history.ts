// 跟網站的 localStorage 紀錄同一個格式；這裡只放純邏輯，讀寫在 storage.ts
export type HistoryItem = {
  kind: 'link' | 'paste'
  code: string
  // 短網址或貼文頁網址
  url: string
  // 短網址的原始網址
  target?: string
  deleteToken: string
  expiresAt: string | null
  createdAt: string
}

export const MAX_HISTORY_ITEMS = 100

export function isExpired(expiresAt: string | null, now = Date.now()): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= now
}

// 過期的連結和貼文已經打不開，刪除碼也用不到了
export function pruneExpired(items: HistoryItem[], now = Date.now()): HistoryItem[] {
  return items.filter((item) => !isExpired(item.expiresAt, now))
}

export function withAdded(items: HistoryItem[], item: HistoryItem): HistoryItem[] {
  return [item, ...items.filter((i) => !(i.kind === item.kind && i.code === item.code))].slice(0, MAX_HISTORY_ITEMS)
}

export function withRemoved(items: HistoryItem[], target: Pick<HistoryItem, 'kind' | 'code'>): HistoryItem[] {
  return items.filter((i) => !(i.kind === target.kind && i.code === target.code))
}

const dateFormat = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })

export function formatExpiry(expiresAt: string | null): string {
  return expiresAt === null ? '永久有效' : `到期：${dateFormat.format(new Date(expiresAt))}`
}

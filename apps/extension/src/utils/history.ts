// 跟網站的 localStorage 紀錄同一個格式和合併規則（@qzz/shared 的 history）；這裡只放純邏輯，讀寫在 storage.ts
import { mergeHistory, removalOf, type HistoryItem, type HistoryState } from '@qzz/shared'

export { MAX_HISTORY_ITEMS, type HistoryItem, type HistoryState } from '@qzz/shared'

export function withAdded(state: HistoryState, item: HistoryItem, now = Date.now()): HistoryState {
  return mergeHistory([{ ...state, items: [item, ...state.items] }], now)
}

// 記下刪除過的項目：網站那邊還有它時，同步也不會再加回來
export function withRemoved(state: HistoryState, item: HistoryItem, now = Date.now()): HistoryState {
  return mergeHistory([{ ...state, removed: [...state.removed, removalOf(item, now)] }], now)
}

const dateFormat = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' })

export function formatExpiry(expiresAt: string | null): string {
  return expiresAt === null ? '永久有效' : `到期：${dateFormat.format(new Date(expiresAt))}`
}

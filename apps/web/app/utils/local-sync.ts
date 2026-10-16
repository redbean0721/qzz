// 只存在瀏覽器裡的資料（建立過的紀錄、設定）。裝了擴充功能時，它的 content script
// （apps/extension/src/entrypoints/sync.content.ts）在這個網站上把兩邊合併：key 和事件名稱兩邊要一致

export const LOCAL_KEYS = {
  history: 'qzz:history:v1',
  historyRemoved: 'qzz:history-removed:v1',
  settings: 'qzz:settings:v1',
} as const

/** 這邊改了資料 → 通知擴充功能 */
export const SYNC_CHANGED_EVENT = 'qzz:sync-changed'
/** 擴充功能把合併結果寫進來了 → 重新讀取 */
export const SYNCED_EVENT = 'qzz:synced'

export function readLocalJson(key: string, fallback: unknown): unknown {
  const raw = localStorage.getItem(key)
  return raw === null ? fallback : JSON.parse(raw)
}

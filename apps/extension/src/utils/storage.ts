import {
  mergeHistory,
  mergeSettings,
  parseHistoryItems,
  parseHistoryRemovals,
  parseStoredSettings,
  resolveSettings,
  sameHistory,
  sameSettings,
  withSetting,
  type HistoryItem,
  type HistoryRemoval,
  type HistoryState,
  type SettingKey,
  type Settings,
  type StoredSettings,
} from '@qzz/shared'
import { storage } from 'wxt/utils/storage'

// 建立過的連結和貼文（含刪除碼），只存在這個瀏覽器；在 qzz.tw 上跟網站的紀錄同步（entrypoints/sync.content.ts）
export const historyItem = storage.defineItem<HistoryItem[]>('local:history', { fallback: [] })
// 刪除過的項目（合併時不再加回來）
export const historyRemovedItem = storage.defineItem<HistoryRemoval[]>('local:historyRemoved', { fallback: [] })

export async function loadHistory(): Promise<HistoryState> {
  const [items, removed] = await Promise.all([historyItem.getValue(), historyRemovedItem.getValue()])
  // 從網站收進來的項目在 content script 已經檢查過網址（readPage）
  return { items: parseHistoryItems(items), removed: parseHistoryRemovals(removed) }
}

async function save(state: HistoryState) {
  // storage 要存普通的陣列和物件：Vue 的響應式 Proxy 交給 setValue 會被存成非陣列的東西
  const plain = JSON.parse(JSON.stringify(state)) as HistoryState
  await Promise.all([historyItem.setValue(plain.items), historyRemovedItem.setValue(plain.removed)])
}

/**
 * 讀最新的紀錄、套用變更、合併後寫回（有變才寫）。每次都從 storage 重新讀，
 * 不用記憶體裡的舊資料，避免蓋掉 content script 剛同步進來的項目
 */
export async function updateHistory(change: (state: HistoryState) => HistoryState = (state) => state): Promise<HistoryState> {
  const current = await loadHistory()
  const next = mergeHistory([change(current)])
  if (!sameHistory(next, current)) await save(next)
  return next
}

/** 跟網站的紀錄合併（呼叫的人要先過濾掉不是這個網站網址的項目）：寫回這邊，回傳合併後的結果 */
export async function mergeIntoHistory(other: HistoryState): Promise<HistoryState> {
  return updateHistory((current) => mergeHistory([current, other]))
}

// 偏好設定：改過的設定和修改時間（@qzz/shared 的 settings），在 qzz.tw 上跟網站的設定同步
export const settingsItem = storage.defineItem<StoredSettings>('local:settings', { fallback: {} })

export async function loadStoredSettings(): Promise<StoredSettings> {
  return parseStoredSettings(await settingsItem.getValue())
}

export async function loadSettings(): Promise<Settings> {
  return resolveSettings(await loadStoredSettings())
}

async function updateStoredSettings(change: (stored: StoredSettings) => StoredSettings): Promise<StoredSettings> {
  const current = await loadStoredSettings()
  const next = mergeSettings([change(current)])
  if (!sameSettings(next, current)) await settingsItem.setValue(JSON.parse(JSON.stringify(next)) as StoredSettings)
  return next
}

export async function saveSetting<K extends SettingKey>(key: K, value: Settings[K]): Promise<Settings> {
  return resolveSettings(await updateStoredSettings((stored) => withSetting(stored, key, value)))
}

/** 跟網站的設定合併：寫回這邊，回傳合併後的結果（由 content script 寫回網站） */
export async function mergeIntoSettings(other: StoredSettings): Promise<StoredSettings> {
  return updateStoredSettings((current) => mergeSettings([current, other]))
}

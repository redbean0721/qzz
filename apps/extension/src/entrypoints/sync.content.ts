import {
  mergeHistory,
  mergeSettings,
  parseHistoryItems,
  parseHistoryRemovals,
  parseStoredSettings,
  sameHistory,
  sameSettings,
  type HistoryState,
  type StoredSettings,
} from '@qzz/shared'
import { API_MATCH_PATTERN, API_ORIGIN } from '../utils/api'
import { historyItem, historyRemovedItem, mergeIntoHistory, mergeIntoSettings, settingsItem } from '../utils/storage'

// 在 qzz.tw 上把網站（localStorage）和擴充功能（storage.local）只存在瀏覽器裡的資料合併，寫回兩邊：
// 建立過的紀錄和偏好設定。content script 跟網頁共用同一份 localStorage，又能用擴充功能的 storage，
// 所以不必經過網頁的程式。兩種情況會跑：使用者開著 qzz.tw（最上層頁面），或彈出視窗 / 設定頁在背景嵌入
// /sync.html（allFrames）。網頁的程式拿不到擴充功能的資料：這裡只把合併結果寫進 localStorage，不回應網頁的任何訊息

// 跟網站 app/utils/local-sync.ts 一致
const KEYS = {
  history: 'qzz:history:v1',
  historyRemoved: 'qzz:history-removed:v1',
  settings: 'qzz:settings:v1',
}
const SYNC_CHANGED_EVENT = 'qzz:sync-changed'
const SYNCED_EVENT = 'qzz:synced'

export default defineContentScript({
  matches: [API_MATCH_PATTERN],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    // pattern 沒有 port：開發時 localhost 的其他 port（例如 API 的 :3001）也會跑到這裡
    if (location.origin !== API_ORIGIN) return
    sync()
    // 擴充功能這邊改了（彈出視窗、設定頁）→ 寫進網站
    historyItem.watch(sync)
    historyRemovedItem.watch(sync)
    settingsItem.watch(sync)
    // 網站這邊改了（這個分頁，或其他 qzz.tw 分頁）→ 寫進擴充功能
    window.addEventListener(SYNC_CHANGED_EVENT, sync)
    window.addEventListener('storage', (event) => {
      if (event.key !== null && Object.values(KEYS).includes(event.key)) sync()
    })
  },
})

// 一次只跑一輪，期間的變更排在後面
let queue = Promise.resolve()
function sync() {
  queue = queue.then(syncOnce).catch((err: unknown) => console.warn('qzz: sync failed', err))
}

function readJson(key: string, fallback: unknown): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : JSON.parse(raw)
  } catch {
    // localStorage 被封鎖或內容壞掉：當作空的，只把擴充功能的資料寫過去
    return fallback
  }
}

// origin 有給時只取這個網站網址的項目（交給擴充功能用）；寫回網站時不給，網站原有的項目不會被丟掉
function readHistory(origin?: string): HistoryState {
  return {
    items: parseHistoryItems(readJson(KEYS.history, []), origin),
    removed: parseHistoryRemovals(readJson(KEYS.historyRemoved, [])),
  }
}

const readSettings = (): StoredSettings => parseStoredSettings(readJson(KEYS.settings, {}))

async function syncOnce() {
  const beforeHistory = readHistory(API_ORIGIN)
  const beforeSettings = readSettings()
  const [history, settings] = await Promise.all([mergeIntoHistory(beforeHistory), mergeIntoSettings(beforeSettings)])

  // await 期間網頁可能又改了 localStorage：重新讀一次再合併。以下沒有 await，網頁的程式插不進來
  const latestHistory = readHistory()
  const latestSettings = readSettings()
  const changedMeanwhile =
    !sameHistory(readHistory(API_ORIGIN), beforeHistory) || !sameSettings(latestSettings, beforeSettings)
  const nextHistory = mergeHistory([latestHistory, history])
  const nextSettings = mergeSettings([latestSettings, settings])

  let wrote = false
  try {
    if (!sameHistory(nextHistory, latestHistory)) {
      localStorage.setItem(KEYS.history, JSON.stringify(nextHistory.items))
      localStorage.setItem(KEYS.historyRemoved, JSON.stringify(nextHistory.removed))
      wrote = true
    }
    if (!sameSettings(nextSettings, latestSettings)) {
      localStorage.setItem(KEYS.settings, JSON.stringify(nextSettings))
      wrote = true
    }
  } catch {
    return
  }
  // 讓網頁重新讀取（同一個分頁寫 localStorage 不會觸發 storage 事件）
  if (wrote) window.dispatchEvent(new Event(SYNCED_EVENT))
  // 網頁在 await 期間改了資料：下一輪寫回擴充功能
  if (changedMeanwhile) sync()
}

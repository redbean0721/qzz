import { mergeHistory, parseHistoryItems, parseHistoryRemovals, sameHistory, type HistoryState } from '@qzz/shared'
import { API_MATCH_PATTERN, API_ORIGIN } from '../utils/api'
import { historyItem, historyRemovedItem, mergeIntoHistory } from '../utils/storage'

// 在 qzz.tw 上把網站（localStorage）和擴充功能（storage.local）建立過的紀錄合併，寫回兩邊。
// content script 跟網頁共用同一份 localStorage，又能用擴充功能的 storage，所以不必經過網頁的程式。
// 兩種情況會跑：使用者開著 qzz.tw（最上層頁面），或彈出視窗在背景嵌入 /sync.html（allFrames）。
// 網頁的程式拿不到擴充功能的資料：這裡只把合併結果寫進 localStorage，不回應網頁的任何訊息

// 跟網站 app/composables/useHistory.ts 的 key 和事件名稱一致
const STORAGE_KEY = 'qzz:history:v1'
const REMOVED_KEY = 'qzz:history-removed:v1'
const CHANGED_EVENT = 'qzz:history-changed'
const SYNCED_EVENT = 'qzz:history-synced'

export default defineContentScript({
  matches: [API_MATCH_PATTERN],
  allFrames: true,
  runAt: 'document_idle',
  main() {
    // pattern 沒有 port：開發時 localhost 的其他 port（例如 API 的 :3001）也會跑到這裡
    if (location.origin !== API_ORIGIN) return
    sync()
    // 擴充功能這邊改了（彈出視窗建立或刪除）→ 寫進網站
    historyItem.watch(sync)
    historyRemovedItem.watch(sync)
    // 網站這邊改了（這個分頁，或其他 qzz.tw 分頁）→ 寫進擴充功能
    window.addEventListener(CHANGED_EVENT, sync)
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === REMOVED_KEY) sync()
    })
  },
})

// 一次只跑一輪，期間的變更排在後面
let queue = Promise.resolve()
function sync() {
  queue = queue.then(syncOnce).catch((err: unknown) => console.warn('qzz: history sync failed', err))
}

// origin 有給時只取這個網站網址的項目（交給擴充功能用）；寫回網站時不給，網站原有的項目不會被丟掉
function readPage(origin?: string): HistoryState {
  const json = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? '[]')
  try {
    return { items: parseHistoryItems(json(STORAGE_KEY), origin), removed: parseHistoryRemovals(json(REMOVED_KEY)) }
  } catch {
    // localStorage 被封鎖或內容壞掉：當作空的，只把擴充功能的紀錄寫過去
    return { items: [], removed: [] }
  }
}

async function syncOnce() {
  const before = readPage(API_ORIGIN)
  const merged = await mergeIntoHistory(before)

  // await 期間網頁可能又改了 localStorage：重新讀一次再合併。這段沒有 await，網頁的程式插不進來
  const latest = readPage()
  const changedMeanwhile = !sameHistory(readPage(API_ORIGIN), before)
  const next = mergeHistory([latest, merged])
  if (!sameHistory(next, latest)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.items))
      localStorage.setItem(REMOVED_KEY, JSON.stringify(next.removed))
    } catch {
      return
    }
    // 讓網頁重新讀取（同一個分頁寫 localStorage 不會觸發 storage 事件）
    window.dispatchEvent(new Event(SYNCED_EVENT))
  }
  // 網頁在 await 期間改了紀錄：下一輪寫回擴充功能
  if (changedMeanwhile) sync()
}

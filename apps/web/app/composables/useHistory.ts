import {
  mergeHistory,
  parseHistoryItems,
  parseHistoryRemovals,
  removalOf,
  sameHistory,
  type HistoryItem,
  type HistoryState,
} from '@qzz/shared'

export type { HistoryItem }

// 擴充功能的 content script（apps/extension/src/entrypoints/sync.content.ts）也讀寫這兩個 key，改名要兩邊一起改
const STORAGE_KEY = 'qzz:history:v1'
const REMOVED_KEY = 'qzz:history-removed:v1'
// 這邊改了紀錄 → 通知擴充功能；擴充功能寫進來 → 通知這邊重新讀取
const CHANGED_EVENT = 'qzz:history-changed'
const SYNCED_EVENT = 'qzz:history-synced'
const PRUNE_INTERVAL_MS = 60 * 1000

// 無痕模式或儲存空間被封鎖時，只保留在記憶體裡
let memory: HistoryState = { items: [], removed: [] }

function readJson(key: string): unknown {
  return JSON.parse(localStorage.getItem(key) ?? '[]')
}

function read(): HistoryState {
  try {
    return { items: parseHistoryItems(readJson(STORAGE_KEY)), removed: parseHistoryRemovals(readJson(REMOVED_KEY)) }
  } catch {
    return memory
  }
}

function write(state: HistoryState) {
  memory = state
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items))
    localStorage.setItem(REMOVED_KEY, JSON.stringify(state.removed))
  } catch {
    // 只留在記憶體
  }
}

// 建立過的連結和貼文（含 delete token）只存在這個瀏覽器；只在 client 使用。
// 裝了擴充功能時，它會在這個網站上把兩邊的紀錄合併（@qzz/shared 的 mergeHistory）
export function useHistory() {
  const items = useState<HistoryItem[]>('history', () => [])
  const loaded = useState('history-loaded', () => false)

  // 讀、改、寫一次做完：localStorage 是同步的，中間不會被擴充功能或其他分頁插進來
  function update(change: (state: HistoryState) => HistoryState = (state) => state) {
    const current = read()
    const next = mergeHistory([change(current)])
    if (!sameHistory(next, current)) {
      write(next)
      window.dispatchEvent(new Event(CHANGED_EVENT))
    }
    items.value = next.items
  }

  if (import.meta.client && !loaded.value) {
    loaded.value = true
    // 順便拿掉過期的項目
    update()
    // 頁面開著時，到期的項目也會自動消失
    setInterval(update, PRUNE_INTERVAL_MS)
    // 其他分頁或擴充功能改了紀錄就重新讀取，避免這邊用舊資料寫回去蓋掉
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === REMOVED_KEY) items.value = read().items
    })
    window.addEventListener(SYNCED_EVENT, () => (items.value = read().items))
  }

  function add(item: Omit<HistoryItem, 'createdAt'>) {
    const created: HistoryItem = { ...item, createdAt: new Date().toISOString() }
    update((state) => ({ ...state, items: [created, ...state.items] }))
  }

  // 記下刪除過的項目，擴充功能那邊還有它時也不會再合併回來
  function remove(item: HistoryItem) {
    update((state) => ({ ...state, removed: [...state.removed, removalOf(item)] }))
  }

  return { items, add, remove }
}

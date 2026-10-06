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

const STORAGE_KEY = 'qzz:history:v1'
const MAX_ITEMS = 100

function read(): HistoryItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? (parsed as HistoryItem[]) : []
  } catch {
    return []
  }
}

function write(items: HistoryItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 無痕模式或儲存空間被封鎖：只保留在記憶體裡
  }
}

// 建立過的連結和貼文（含 delete token）只存在這個瀏覽器；只在 client 使用
export function useHistory() {
  const items = useState<HistoryItem[]>('history', () => [])
  const loaded = useState('history-loaded', () => false)

  if (import.meta.client && !loaded.value) {
    items.value = read()
    loaded.value = true
  }

  function add(item: Omit<HistoryItem, 'createdAt'>) {
    items.value = [{ ...item, createdAt: new Date().toISOString() }, ...items.value].slice(0, MAX_ITEMS)
    write(items.value)
  }

  function remove(item: Pick<HistoryItem, 'kind' | 'code'>) {
    items.value = items.value.filter((i) => !(i.kind === item.kind && i.code === item.code))
    write(items.value)
  }

  return { items, add, remove }
}

import { storage } from 'wxt/utils/storage'
import type { HistoryItem } from './history'

// 這個擴充功能建立過的連結和貼文（含刪除碼），只存在這個瀏覽器
export const historyItem = storage.defineItem<HistoryItem[]>('local:history', { fallback: [] })

// 右鍵選單帶給彈出視窗的內容；彈出視窗讀到後就清掉
export type Pending =
  | { kind: 'link'; url: string; at: number }
  | { kind: 'paste'; content: string; at: number }

export const pendingItem = storage.defineItem<Pending | null>('local:pending', { fallback: null })

// 超過這個時間沒被彈出視窗接走，就當作作廢（例如彈出視窗沒開成功）
export const PENDING_TTL_MS = 60 * 1000

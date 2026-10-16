import { z } from 'zod'
import { expiresInSchema, type ExpiresIn } from './schemas/common.js'

// 使用者的偏好設定，只存在瀏覽器：網站在 localStorage，擴充功能在 storage.local，兩邊各自都能改。
// 擴充功能的 content script 在 qzz.tw 上合併（mergeSettings）：每個設定各自比較修改時間，新的贏

export type Settings = {
  /** 短網址的預設有效期限 */
  linkExpiresIn: ExpiresIn
  /** 貼文的預設有效期限 */
  pasteExpiresIn: ExpiresIn
  /** 貼文的預設語言（語言代號；目前不支援的語言在表單裡會變回純文字） */
  pasteLanguage: string
  /** 建立後自動把網址複製到剪貼簿 */
  autoCopy: boolean
  /** 建立貼文時預設勾選閱後即焚 */
  burnAfterReading: boolean
}

export type SettingKey = keyof Settings

export const DEFAULT_SETTINGS: Settings = {
  linkExpiresIn: '1d',
  pasteExpiresIn: '1d',
  pasteLanguage: 'text',
  autoCopy: true,
  burnAfterReading: false,
}

const valueSchemas: { [K in SettingKey]: z.ZodType<Settings[K]> } = {
  linkExpiresIn: expiresInSchema,
  pasteExpiresIn: expiresInSchema,
  // 跟擴充功能檢查 API 語言清單的格式一樣
  pasteLanguage: z.string().regex(/^[a-z0-9+#-]{1,32}$/),
  autoCopy: z.boolean(),
  burnAfterReading: z.boolean(),
}

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[]

/** 存起來的格式：改過的設定才有，記下值和修改時間 */
export type StoredSettings = { [K in SettingKey]?: { value: Settings[K]; updatedAt: string } }

const updatedAtSchema = z.iso.datetime({ offset: true })

/** 從儲存空間讀到的值：不認得的設定、格式不對的值都丟掉（那個設定就用預設值） */
export function parseStoredSettings(value: unknown): StoredSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const stored: Record<string, unknown> = {}
  for (const key of SETTING_KEYS) {
    const entry = (value as Record<string, unknown>)[key]
    if (typeof entry !== 'object' || entry === null) continue
    const parsed = valueSchemas[key].safeParse((entry as { value?: unknown }).value)
    const updatedAt = updatedAtSchema.safeParse((entry as { updatedAt?: unknown }).updatedAt)
    if (parsed.success && updatedAt.success) stored[key] = { value: parsed.data, updatedAt: updatedAt.data }
  }
  return stored as StoredSettings
}

/** 實際使用的設定：沒改過的用預設值 */
export function resolveSettings(stored: StoredSettings): Settings {
  const settings = { ...DEFAULT_SETTINGS }
  for (const key of SETTING_KEYS) {
    const entry = stored[key]
    if (entry) (settings as Record<SettingKey, unknown>)[key] = entry.value
  }
  return settings
}

export function withSetting<K extends SettingKey>(
  stored: StoredSettings,
  key: K,
  value: Settings[K],
  now = Date.now(),
): StoredSettings {
  return { ...stored, [key]: { value, updatedAt: new Date(now).toISOString() } }
}

/** 合併幾份設定：每個設定取修改時間最新的（時間相同時取值的 JSON 較大的，結果跟順序無關） */
export function mergeSettings(all: StoredSettings[]): StoredSettings {
  const merged: Record<string, { value: unknown; updatedAt: string }> = {}
  for (const key of SETTING_KEYS) {
    for (const stored of all) {
      const entry = stored[key]
      if (!entry) continue
      const current = merged[key]
      const diff = current ? Date.parse(entry.updatedAt) - Date.parse(current.updatedAt) : 1
      if (diff > 0 || (diff === 0 && JSON.stringify(entry.value) > JSON.stringify(current!.value))) {
        merged[key] = { value: entry.value, updatedAt: entry.updatedAt }
      }
    }
  }
  return merged as StoredSettings
}

export function sameSettings(a: StoredSettings, b: StoredSettings): boolean {
  const normalize = (s: StoredSettings) => JSON.stringify(SETTING_KEYS.map((key) => s[key] ?? null))
  return normalize(a) === normalize(b)
}

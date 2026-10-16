import {
  DEFAULT_SETTINGS,
  mergeSettings,
  parseStoredSettings,
  resolveSettings,
  sameSettings,
  withSetting,
  type SettingKey,
  type Settings,
  type StoredSettings,
} from '@qzz/shared'

// 無痕模式或儲存空間被封鎖時，只保留在記憶體裡
let memory: StoredSettings = {}

function read(): StoredSettings {
  try {
    return parseStoredSettings(readLocalJson(LOCAL_KEYS.settings, {}))
  } catch {
    return memory
  }
}

function write(stored: StoredSettings) {
  memory = stored
  try {
    localStorage.setItem(LOCAL_KEYS.settings, JSON.stringify(stored))
  } catch {
    // 只留在記憶體
  }
}

/**
 * 偏好設定（只存在這個瀏覽器，裝了擴充功能時跟它同步）。伺服器端和 hydration 前都是預設值，
 * 掛載後才讀 localStorage：表單的初始值才不會讓 SSR 和瀏覽器的畫面不一致
 */
export function useSettings() {
  const settings = useState<Settings>('settings', () => ({ ...DEFAULT_SETTINGS }))
  const loaded = useState('settings-loaded', () => false)

  const reload = () => (settings.value = resolveSettings(read()))

  onMounted(() => {
    if (loaded.value) return
    loaded.value = true
    reload()
    window.addEventListener('storage', (event) => {
      if (event.key === LOCAL_KEYS.settings) reload()
    })
    window.addEventListener(SYNCED_EVENT, reload)
  })

  // 讀、改、寫一次做完（localStorage 是同步的），再通知擴充功能
  function set<K extends SettingKey>(key: K, value: Settings[K]) {
    const current = read()
    const next = mergeSettings([withSetting(current, key, value)])
    if (!sameSettings(next, current)) {
      write(next)
      window.dispatchEvent(new Event(SYNC_CHANGED_EVENT))
    }
    settings.value = resolveSettings(next)
  }

  return { settings: readonly(settings), loaded: readonly(loaded), set }
}

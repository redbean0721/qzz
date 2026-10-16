<script setup lang="ts">
import { DEFAULT_SETTINGS, PASTE_LANGUAGES, SETTING_KEYS, type SettingKey, type Settings } from '@qzz/shared'
import { Check, RotateCcw } from 'lucide-vue-next'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ExpirySelect from '../../components/ExpirySelect.vue'
import SyncFrame from '../../components/SyncFrame.vue'
import { API_ORIGIN, fetchLanguages } from '../../utils/api'
import { loadSettings, saveSetting, settingsItem } from '../../utils/storage'

// 擴充功能的設定頁。跟網站的 /settings 是同一份設定：打開這頁或 qzz.tw 時，content script 會把兩邊合併

const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
// 先用內建的清單，API 回應後換成伺服器目前支援的
const languages = ref<readonly string[]>(PASTE_LANGUAGES)
const saved = ref(false)
let savedTimer: ReturnType<typeof setTimeout> | undefined
let unwatch: (() => void) | undefined

const refresh = async () => {
  settings.value = await loadSettings()
}

onMounted(async () => {
  // 先開始監聽再讀：同步用的 iframe 可能在 await 期間就把網站的設定寫進來
  unwatch = settingsItem.watch(() => void refresh())
  await refresh()
  const latest = await fetchLanguages()
  if (latest) languages.value = latest
})
onUnmounted(() => unwatch?.())

async function set<K extends SettingKey>(key: K, value: Settings[K]) {
  settings.value = await saveSetting(key, value)
  saved.value = true
  clearTimeout(savedTimer)
  savedTimer = setTimeout(() => (saved.value = false), 1500)
}

// 設定的語言可能是這個版本的清單沒有的：選單上顯示成純文字
const language = computed(() =>
  languages.value.includes(settings.value.pasteLanguage) ? settings.value.pasteLanguage : 'text',
)
const isDefault = computed(() => SETTING_KEYS.every((key) => settings.value[key] === DEFAULT_SETTINGS[key]))

async function resetAll() {
  for (const key of SETTING_KEYS) await set(key, DEFAULT_SETTINGS[key])
}

const selectClass =
  'rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100'
const labelClass = 'flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400'
const sectionTitle = 'mb-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400'
</script>

<template>
  <div class="mx-auto max-w-xl px-6 py-10">
    <header class="flex items-baseline justify-between">
      <h1 class="text-xl font-bold">
        <span class="font-mono">qzz<span class="text-emerald-500">.tw</span></span> 設定
      </h1>
      <span
        class="flex items-center gap-1 text-xs text-emerald-600 transition-opacity dark:text-emerald-400"
        :class="saved ? 'opacity-100' : 'opacity-0'"
        aria-live="polite"
      >
        <Check class="size-3.5" /> 已儲存
      </span>
    </header>
    <p class="mt-2 text-sm leading-6 text-zinc-500 dark:text-zinc-400">
      變更會立即儲存在這個瀏覽器，並跟
      <a :href="`${API_ORIGIN}/settings`" target="_blank" rel="noopener" class="underline">qzz.tw 網站的設定</a>
      自動同步。
    </p>

    <section class="mt-8">
      <h2 :class="sectionTitle">短網址</h2>
      <div class="w-fit">
        <ExpirySelect
          :model-value="settings.linkExpiresIn"
          label="預設有效期限"
          @update:model-value="(value) => set('linkExpiresIn', value)"
        />
      </div>
    </section>

    <section class="mt-8">
      <h2 :class="sectionTitle">貼文</h2>
      <div class="flex flex-wrap gap-4">
        <ExpirySelect
          :model-value="settings.pasteExpiresIn"
          label="預設有效期限"
          @update:model-value="(value) => set('pasteExpiresIn', value)"
        />
        <label :class="labelClass">
          預設語言
          <select
            :value="language"
            :class="selectClass"
            @change="set('pasteLanguage', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="value in languages" :key="value" :value="value">
              {{ value === 'text' ? '純文字' : value }}
            </option>
          </select>
        </label>
      </div>
      <label class="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          class="mt-0.5 size-4 accent-emerald-500"
          :checked="settings.burnAfterReading"
          @change="set('burnAfterReading', ($event.target as HTMLInputElement).checked)"
        />
        <span>
          預設勾選閱後即焚
          <span class="block text-xs text-zinc-500 dark:text-zinc-400">建立貼文時預設勾選，第一次打開就刪除</span>
        </span>
      </label>
    </section>

    <section class="mt-8">
      <h2 :class="sectionTitle">建立之後</h2>
      <label class="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          class="mt-0.5 size-4 accent-emerald-500"
          :checked="settings.autoCopy"
          @change="set('autoCopy', ($event.target as HTMLInputElement).checked)"
        />
        <span>
          自動複製網址
          <span class="block text-xs text-zinc-500 dark:text-zinc-400">建立短網址或貼文後，自動把網址複製到剪貼簿</span>
        </span>
      </label>
    </section>

    <button
      type="button"
      class="mt-10 flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      :disabled="isDefault"
      @click="resetAll"
    >
      <RotateCcw class="size-4" /> 恢復預設值
    </button>

    <SyncFrame />
  </div>
</template>

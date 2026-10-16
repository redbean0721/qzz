<script setup lang="ts">
import { MAX_PASTE_BYTES, PASTE_LANGUAGES, createPasteSchema, type ExpiresIn, type PasteResponse } from '@qzz/shared'
import { LoaderCircle, Send } from 'lucide-vue-next'
import { computed, onMounted, ref, watch } from 'vue'
import { createPaste, fetchLanguages } from '../utils/api'
import ExpirySelect from './ExpirySelect.vue'

const content = defineModel<string>('content', { required: true })
const props = defineProps<{ defaults: { language: string; expiresIn: ExpiresIn; burnAfterReading: boolean } }>()
const emit = defineEmits<{ created: [PasteResponse & { burnAfterReading: boolean }] }>()

// 先用內建的清單，API 回應後換成伺服器目前支援的（新增語言不用發新版）
const languages = ref<readonly string[]>(PASTE_LANGUAGES)
// 設定裡的語言不在清單上就用純文字
const supported = (value: string) => (languages.value.includes(value) ? value : 'text')
const language = ref<string>(supported(props.defaults.language))
const expiresIn = ref<ExpiresIn>(props.defaults.expiresIn)
const burnAfterReading = ref(props.defaults.burnAfterReading)
// 使用者自己選過語言，API 的清單回來時就不再套用設定
const languageChosen = ref(false)
// 設定讀到或同步過來時換掉預設值
watch(
  () => props.defaults.language,
  (value) => (language.value = supported(value)),
)
watch(
  () => props.defaults.expiresIn,
  (value) => (expiresIn.value = value),
)
watch(
  () => props.defaults.burnAfterReading,
  (value) => (burnAfterReading.value = value),
)
const loading = ref(false)
const error = ref('')

const encoder = new TextEncoder()
const bytes = computed(() => encoder.encode(content.value).length)
const formatKB = (n: number) => `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`

onMounted(async () => {
  const latest = await fetchLanguages()
  if (!latest) return
  languages.value = latest
  // 設定的語言可能是內建清單沒有、API 才有的
  language.value = supported(languageChosen.value ? language.value : props.defaults.language)
})

async function submit() {
  error.value = ''
  // 語言不在這裡檢查：清單可能比內建的新，交給 API
  const parsed = createPasteSchema.omit({ language: true }).safeParse({
    content: content.value,
    expiresIn: expiresIn.value,
    burnAfterReading: burnAfterReading.value,
  })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? '輸入的內容有誤'
    return
  }

  loading.value = true
  try {
    const res = await createPaste({ ...parsed.data, language: language.value })
    emit('created', { ...res, burnAfterReading: parsed.data.burnAfterReading })
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="flex flex-col gap-3" @submit.prevent="submit">
    <label class="flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
      <span class="flex justify-between">
        內容
        <span :class="bytes > MAX_PASTE_BYTES ? 'text-red-600 dark:text-red-400' : ''">
          {{ formatKB(bytes) }} / {{ formatKB(MAX_PASTE_BYTES) }}
        </span>
      </span>
      <textarea
        v-model="content"
        rows="8"
        placeholder="貼上文字或程式碼"
        class="resize-y rounded-md border border-zinc-300 bg-white px-2.5 py-2 font-mono text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
      />
    </label>

    <label class="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300">
      <input v-model="burnAfterReading" type="checkbox" class="size-3.5 accent-emerald-500" />
      閱後即焚
      <span class="text-zinc-500 dark:text-zinc-400">（第一次打開就刪除）</span>
    </label>

    <div class="flex items-end gap-3">
      <label class="flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        語言
        <select
          v-model="language"
          @change="languageChosen = true"
          class="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option v-for="value in languages" :key="value" :value="value">
            {{ value === 'text' ? '純文字' : value }}
          </option>
        </select>
      </label>
      <ExpirySelect v-model="expiresIn" />
      <button
        type="submit"
        :disabled="loading"
        class="ml-auto flex items-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
      >
        <LoaderCircle v-if="loading" class="size-4 animate-spin" />
        <Send v-else class="size-4" />
        建立
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
  </form>
</template>

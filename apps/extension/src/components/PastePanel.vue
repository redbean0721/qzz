<script setup lang="ts">
import { MAX_PASTE_BYTES, PASTE_LANGUAGES, createPasteSchema, type ExpiresIn, type PasteResponse } from '@qzz/shared'
import { LoaderCircle, Send } from 'lucide-vue-next'
import { computed, onMounted, ref } from 'vue'
import { createPaste, fetchLanguages } from '../utils/api'
import ExpirySelect from './ExpirySelect.vue'

const content = defineModel<string>('content', { required: true })
const emit = defineEmits<{ created: [PasteResponse & { burnAfterReading: boolean }] }>()

const language = ref<string>('text')
// 先用內建的清單，API 回應後換成伺服器目前支援的（新增語言不用發新版）
const languages = ref<readonly string[]>(PASTE_LANGUAGES)
const expiresIn = ref<ExpiresIn>('1d')
const burnAfterReading = ref(false)
const loading = ref(false)
const error = ref('')

const encoder = new TextEncoder()
const bytes = computed(() => encoder.encode(content.value).length)
const formatKB = (n: number) => `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`

onMounted(async () => {
  const latest = await fetchLanguages()
  if (!latest) return
  languages.value = latest
  if (!latest.includes(language.value)) language.value = 'text'
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

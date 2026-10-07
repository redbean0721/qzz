<script setup lang="ts">
import { MAX_PASTE_BYTES, PASTE_LANGUAGES, createPasteSchema, type ExpiresIn, type PasteResponse } from '@qzz/shared'
import { LoaderCircle, Send } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { createPaste } from '../utils/api'
import ExpirySelect from './ExpirySelect.vue'

const content = defineModel<string>('content', { required: true })
const emit = defineEmits<{ created: [PasteResponse] }>()

const language = ref<string>('text')
const expiresIn = ref<ExpiresIn>('30d')
const loading = ref(false)
const error = ref('')

const encoder = new TextEncoder()
const bytes = computed(() => encoder.encode(content.value).length)
const formatKB = (n: number) => `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`

async function submit() {
  error.value = ''
  const parsed = createPasteSchema.safeParse({ content: content.value, language: language.value, expiresIn: expiresIn.value })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? '輸入的內容有誤'
    return
  }

  loading.value = true
  try {
    emit('created', await createPaste(parsed.data))
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

    <div class="flex items-end gap-3">
      <label class="flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        語言
        <select
          v-model="language"
          class="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option v-for="value in PASTE_LANGUAGES" :key="value" :value="value">
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

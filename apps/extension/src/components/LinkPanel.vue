<script setup lang="ts">
import { createLinkSchema, type ExpiresIn, type LinkResponse } from '@qzz/shared'
import { LoaderCircle, Scissors } from 'lucide-vue-next'
import { ref } from 'vue'
import { createLink } from '../utils/api'
import ExpirySelect from './ExpirySelect.vue'

const url = defineModel<string>('url', { required: true })
const emit = defineEmits<{ created: [LinkResponse] }>()

const expiresIn = ref<ExpiresIn>('1d')
const loading = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  // 跟網站和 API 用同一份 schema 先檢查，錯誤訊息也一樣
  const parsed = createLinkSchema.safeParse({ url: url.value.trim(), expiresIn: expiresIn.value })
  if (!parsed.success) {
    error.value = parsed.error.issues[0]?.message ?? '輸入的內容有誤'
    return
  }

  loading.value = true
  try {
    emit('created', await createLink(parsed.data))
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
      網址
      <input
        v-model="url"
        type="text"
        inputmode="url"
        placeholder="https://example.com/很長的網址"
        class="rounded-md border border-zinc-300 bg-white px-2.5 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        autofocus
      />
    </label>

    <div class="flex items-end gap-3">
      <ExpirySelect v-model="expiresIn" />
      <button
        type="submit"
        :disabled="loading"
        class="ml-auto flex items-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-60"
      >
        <LoaderCircle v-if="loading" class="size-4 animate-spin" />
        <Scissors v-else class="size-4" />
        縮短
      </button>
    </div>

    <p v-if="error" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
  </form>
</template>

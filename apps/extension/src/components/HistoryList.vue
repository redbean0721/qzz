<script setup lang="ts">
import { Copy, FileText, Link, LoaderCircle, Trash2 } from 'lucide-vue-next'
import { ref } from 'vue'
import { ApiError, deleteItem } from '../utils/api'
import { formatExpiry, type HistoryItem } from '../utils/history'

defineProps<{ items: HistoryItem[] }>()
const emit = defineEmits<{ copy: [string]; removed: [HistoryItem] }>()

const keyOf = (item: HistoryItem) => `${item.kind}:${item.code}`
// 刪除要按兩次：第一次進入確認狀態
const confirming = ref<string | null>(null)
const deleting = ref<string | null>(null)
const message = ref('')

async function onDelete(item: HistoryItem) {
  const key = keyOf(item)
  if (confirming.value !== key) {
    confirming.value = key
    return
  }

  confirming.value = null
  deleting.value = key
  message.value = ''
  try {
    await deleteItem(item.kind, item.code, item.deleteToken)
    emit('removed', item)
  } catch (err) {
    // 404：已過期、已被刪除或刪除碼不對，伺服器上已經沒有了，一樣從紀錄移除
    if (err instanceof ApiError && err.status === 404) {
      emit('removed', item)
    } else {
      message.value = err instanceof Error ? err.message : String(err)
    }
  } finally {
    deleting.value = null
  }
}
</script>

<template>
  <section v-if="items.length > 0" class="mt-5">
    <h2 class="mb-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">這個擴充功能建立過的</h2>
    <p v-if="message" class="mb-2 text-xs text-red-600 dark:text-red-400">{{ message }}</p>

    <ul class="max-h-64 divide-y divide-zinc-200 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      <li v-for="item in items" :key="keyOf(item)" class="flex items-center gap-2 px-3 py-2">
        <Link v-if="item.kind === 'link'" class="size-4 shrink-0 text-zinc-400" />
        <FileText v-else class="size-4 shrink-0 text-zinc-400" />

        <div class="min-w-0 flex-1">
          <a
            :href="item.url"
            target="_blank"
            rel="noopener"
            class="block truncate font-mono text-xs text-emerald-700 dark:text-emerald-400"
          >
            {{ item.url }}
          </a>
          <p class="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
            <template v-if="item.target">{{ item.target }} · </template>{{ formatExpiry(item.expiresAt) }}
          </p>
        </div>

        <button
          type="button"
          aria-label="複製"
          class="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          @click="$emit('copy', item.url)"
        >
          <Copy class="size-3.5" />
        </button>
        <button
          type="button"
          :aria-label="confirming === keyOf(item) ? '確定刪除' : '刪除'"
          class="flex items-center rounded px-1 py-1 text-xs"
          :class="
            confirming === keyOf(item)
              ? 'bg-red-600 px-2 text-white'
              : 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
          "
          :disabled="deleting === keyOf(item)"
          @click="onDelete(item)"
          @blur="confirming === keyOf(item) && (confirming = null)"
        >
          <LoaderCircle v-if="deleting === keyOf(item)" class="size-3.5 animate-spin" />
          <template v-else-if="confirming === keyOf(item)">確定刪除？</template>
          <Trash2 v-else class="size-3.5" />
        </button>
      </li>
    </ul>
  </section>
</template>

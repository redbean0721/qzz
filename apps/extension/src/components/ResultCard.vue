<script setup lang="ts">
import { Check, Copy, KeyRound } from 'lucide-vue-next'
import { formatExpiry } from '../utils/history'

export type Result = { url: string; rawUrl?: string; expiresAt: string | null; copied: boolean }

defineProps<{ result: Result }>()
defineEmits<{ copy: [string] }>()
</script>

<template>
  <section class="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 dark:bg-emerald-950/30">
    <div class="flex items-center gap-2">
      <a
        :href="result.url"
        target="_blank"
        rel="noopener"
        class="min-w-0 flex-1 truncate font-mono text-sm text-emerald-700 dark:text-emerald-400"
      >
        {{ result.url }}
      </a>
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-600"
        @click="$emit('copy', result.url)"
      >
        <Check v-if="result.copied" class="size-3.5" />
        <Copy v-else class="size-3.5" />
        {{ result.copied ? '已複製' : '複製' }}
      </button>
    </div>
    <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
      {{ formatExpiry(result.expiresAt) }}
      <template v-if="result.rawUrl">
        · <a :href="result.rawUrl" target="_blank" rel="noopener" class="underline">raw</a>
      </template>
    </p>
    <p class="mt-2 flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
      <KeyRound class="mt-0.5 size-3.5 shrink-0" />
      刪除碼已存進這個擴充功能的紀錄，可以在下方刪除；移除擴充功能後就無法再刪除。
    </p>
  </section>
</template>

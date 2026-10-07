<script setup lang="ts">
import { EXPIRES_IN, EXPIRES_IN_LABELS, type ExpiresIn } from '@qzz/shared'

const model = defineModel<ExpiresIn>({ required: true })
</script>

<template>
  <label class="flex flex-col gap-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
    有效期限
    <select
      v-model="model"
      class="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
    >
      <option v-for="value in EXPIRES_IN" :key="value" :value="value">{{ EXPIRES_IN_LABELS[value] }}</option>
    </select>
  </label>
</template>

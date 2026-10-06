<script setup lang="ts">
defineProps<{
  url: string
  deleteToken: string
  expiresAt: string | null
  rawUrl?: string
}>()

const copy = useCopy()
</script>

<template>
  <UCard variant="subtle" class="mt-6">
    <div class="flex items-center gap-2">
      <a :href="url" target="_blank" rel="noopener" class="min-w-0 flex-1 truncate font-mono text-lg text-primary">
        {{ url }}
      </a>
      <UButton icon="i-lucide-copy" label="複製" @click="copy(url)" />
    </div>

    <p class="mt-2 text-sm text-muted">
      <ExpiryText :expires-at="expiresAt" />
      <template v-if="rawUrl">
        ·
        <a :href="rawUrl" target="_blank" rel="noopener" class="underline">raw</a>
      </template>
    </p>

    <UAlert
      class="mt-4"
      color="warning"
      variant="subtle"
      icon="i-lucide-key-round"
      title="刪除碼只會顯示這一次"
      description="已存進這個瀏覽器的紀錄，可在下方刪除；換瀏覽器或清除資料就無法再刪除。"
    >
      <template #actions>
        <UButton
          size="xs"
          color="warning"
          variant="outline"
          icon="i-lucide-copy"
          label="複製刪除碼"
          @click="copy(deleteToken, '已複製刪除碼')"
        />
      </template>
    </UAlert>
  </UCard>
</template>

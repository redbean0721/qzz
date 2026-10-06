<script setup lang="ts">
useSeoMeta({
  description: '免登入的短網址與文字貼上服務。',
})

const tabs = [
  { label: '短網址', icon: 'i-lucide-link', slot: 'link' as const },
  { label: '貼文', icon: 'i-lucide-file-text', slot: 'paste' as const },
]
</script>

<template>
  <div>
    <UTabs :items="tabs" class="w-full" :ui="{ content: 'pt-4' }">
      <template #link>
        <LinkForm />
      </template>
      <template #paste>
        <PasteForm />
      </template>
    </UTabs>

    <!-- 紀錄存在 localStorage，只在瀏覽器端渲染 -->
    <ClientOnly>
      <HistoryList />
    </ClientOnly>
  </div>
</template>

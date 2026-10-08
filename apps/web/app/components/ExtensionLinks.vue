<script setup lang="ts">
const STORES = [
  { label: 'Chrome / Edge', to: 'https://chromewebstore.google.com/detail/mjoadeofebgfmgoolhccpefhjicjgpac' },
  { label: 'Firefox', to: 'https://addons.mozilla.org/firefox/addon/qzz/' },
]
</script>

<template>
  <section class="mt-8 flex flex-col gap-3 rounded-lg border border-default p-4 sm:flex-row sm:items-center">
    <div class="flex-1">
      <p class="text-sm font-medium">瀏覽器擴充功能</p>
      <p class="text-xs text-muted">一鍵縮短目前分頁，或在網頁上按右鍵把連結、選取的文字建立成短網址或貼文。</p>
    </div>
    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="store in STORES"
        :key="store.label"
        :to="store.to"
        target="_blank"
        icon="i-lucide-puzzle"
        trailing-icon="i-lucide-external-link"
        :label="store.label"
        color="neutral"
        variant="outline"
        size="sm"
      />
    </div>
  </section>
</template>

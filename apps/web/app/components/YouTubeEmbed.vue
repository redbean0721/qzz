<script setup lang="ts">
// 直接嵌入 YouTube 自己的播放器（隱私強化模式 youtube-nocookie.com）。
// YouTube 嵌入要有 Referer（缺少時播放器顯示錯誤 153），所以 iframe 用 strict-origin-when-cross-origin，
// 只送出 https://qzz.tw，不含路徑
const props = defineProps<{ id: string; start?: number; title?: string | null }>()

const src = computed(() => {
  const query = props.start ? `?start=${props.start}` : ''
  return `https://www.youtube-nocookie.com/embed/${props.id}${query}`
})
</script>

<template>
  <iframe
    :src="src"
    :title="title || 'YouTube 影片'"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share"
    allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin"
    class="block aspect-video w-full bg-black"
  />
</template>

<script setup lang="ts">
import { embedUrl, type LinkEmbed } from '@qzz/shared'

// 直接嵌入影片網站自己的播放器（YouTube 用隱私強化模式 youtube-nocookie.com，Vimeo 帶 dnt=1）。
// YouTube 嵌入要有 Referer（缺少時播放器顯示錯誤 153），所以 iframe 用 strict-origin-when-cross-origin，
// 只送出 https://qzz.tw，不含路徑。Twitch 要帶 parent=這個網站的主機名稱
const props = defineProps<{ embed: LinkEmbed; title?: string | null }>()

const NAMES: Record<LinkEmbed['provider'], string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  twitch: 'Twitch',
  bilibili: 'Bilibili',
  niconico: 'Niconico',
}

const { hostname } = useRequestURL()
const src = computed(() => embedUrl(props.embed, hostname))
</script>

<template>
  <iframe
    :src="src"
    :title="title || `${NAMES[embed.provider]} 影片`"
    allow="autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write; web-share"
    allowfullscreen
    referrerpolicy="strict-origin-when-cross-origin"
    class="block aspect-video w-full bg-black"
  />
</template>

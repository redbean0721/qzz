<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { API_ORIGIN } from '../utils/api'

// 在背景嵌入 qzz.tw 的空白頁，讓 content script（entrypoints/sync.content.ts）把網站的紀錄和設定同步過來；
// 結果由呼叫的頁面從 storage 的變更通知拿到，所以要在掛上這個元件之前就開始監聽。
// 等 load 之後才放上 iframe：Chrome 要等彈出視窗的 load（含所有 iframe）才把視窗顯示出來，一開始就放會慢上幾百毫秒
const src = `${API_ORIGIN}/sync.html`
const ready = ref(false)

onMounted(() => {
  const show = () => setTimeout(() => (ready.value = true))
  if (document.readyState === 'complete') show()
  else window.addEventListener('load', show, { once: true })
})
</script>

<template>
  <!-- 看不到也不能操作 -->
  <iframe v-if="ready" :src="src" class="hidden" tabindex="-1" aria-hidden="true" title="sync" />
</template>

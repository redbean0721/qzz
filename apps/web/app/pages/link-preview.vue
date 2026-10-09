<script setup lang="ts">
import type { LinkView } from '@qzz/shared'

// qzz.tw/<code>+：不轉址，先顯示短網址會前往哪裡（跟 bit.ly 一樣在後面加 +）。
// 路徑裡的 + 要跳脫，否則 vue-router 會當成「可重複的參數」。vue-router 比對的是編碼後的路徑，
// 伺服器端收到的會是 %2B（瀏覽器端是 +），所以用 alias 兩種都接
definePageMeta({
  path: '/:code([0-9A-Za-z]{1,16})\\+',
  alias: ['/:code([0-9A-Za-z]{1,16})%2B', '/:code([0-9A-Za-z]{1,16})%2b'],
})

const route = useRoute()
const code = String(route.params.code)
const { host, origin } = useRequestURL()

useSeoMeta({
  title: `短網址 ${code} 的預覽 – qzz`,
  robots: 'noindex, nofollow',
})

const { data: link, error } = await useFetch<LinkView>(`/v1/links/${code}/info`, {
  // 跟貼文頁一樣：baseURL 兩邊不同，要給固定的 key
  key: `link:${code}`,
  baseURL: import.meta.server ? useRuntimeConfig().apiBase : undefined,
})

if (error.value || !link.value) {
  const notFound = error.value?.statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 502,
    statusMessage: notFound ? 'Not Found' : 'Bad Gateway',
    fatal: true,
  })
}

// 網域單獨顯示：釣魚網址常把真正的網域藏在長網址中間。國際化網域會顯示成 xn-- 開頭的原始形式
const domain = computed(() => (link.value ? new URL(link.value.url).hostname : ''))
const reportUrl = { path: '/report', query: { url: `${origin}/${code}` } }
const copy = useCopy()
</script>

<template>
  <div v-if="link">
    <h1 class="text-2xl font-bold">短網址預覽</h1>
    <p class="mt-1 font-mono text-sm text-muted">{{ host }}/{{ link.code }}</p>

    <UCard variant="subtle" class="mt-6">
      <p class="text-sm text-muted">會前往</p>
      <p class="mt-1 text-xl font-semibold break-all">{{ domain }}</p>
      <p class="mt-2 font-mono text-sm break-all">{{ link.url }}</p>
      <p class="mt-3 text-xs text-muted">
        建立於 <NuxtTime :datetime="link.createdAt" locale="zh-TW" date-style="medium" time-style="short" />
        · <ExpiryText :expires-at="link.expiresAt" />
      </p>
    </UCard>

    <div class="mt-4 flex flex-wrap items-center gap-2">
      <UButton
        :to="link.url"
        external
        rel="nofollow noreferrer"
        trailing-icon="i-lucide-arrow-right"
        label="前往"
        size="lg"
      />
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-copy"
        label="複製網址"
        size="lg"
        @click="copy(link.url)"
      />
      <UButton
        color="neutral"
        variant="ghost"
        icon="i-lucide-flag"
        label="檢舉"
        size="lg"
        class="ml-auto"
        :to="reportUrl"
      />
    </div>

    <p class="mt-6 text-xs leading-5 text-muted">
      短網址由任何人匿名建立，qzz.tw 不會逐一審查。前往前請確認網域是你信任的網站，不要在陌生網站輸入帳號密碼；遇到釣魚、詐騙或惡意網址，請按「檢舉」。
    </p>
  </div>
</template>

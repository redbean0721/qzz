<script setup lang="ts">
import type { PasteView } from '@qzz/shared'

const route = useRoute()
const code = String(route.params.code)

useSeoMeta({
  title: `貼文 ${code} – qzz`,
  robots: 'noindex, nofollow',
})

if (!/^[0-9A-Za-z]{1,16}$/.test(code)) {
  throw createError({ statusCode: 404, statusMessage: 'Not Found', fatal: true })
}

const { data: paste, error } = await useFetch<PasteView>(`/v1/pastes/${code}`, {
  // 伺服器端直接連 API；瀏覽器端走同源的 /v1。
  // baseURL 兩邊不同，自動產生的 key 也會不同，所以要給固定的 key，hydration 才拿得到 SSR 的資料
  key: `paste:${code}`,
  baseURL: import.meta.server ? useRuntimeConfig().apiBase : undefined,
})

if (error.value || !paste.value) {
  const notFound = error.value?.statusCode === 404
  throw createError({
    statusCode: notFound ? 404 : 502,
    statusMessage: notFound ? 'Not Found' : 'Bad Gateway',
    fatal: true,
  })
}

const rawUrl = `/v1/pastes/${code}/raw`
const lineCount = computed(() => paste.value?.content.split('\n').length ?? 0)
const copy = useCopy()

// 伺服器端先輸出純文字；瀏覽器載入後才下載 Shiki 上色（不佔 Worker 的大小和 CPU）
const highlighted = ref<string | null>(null)
onMounted(async () => {
  const current = paste.value
  if (!current || !canHighlight(current.language, current.content)) return
  try {
    highlighted.value = await highlight(current.content, current.language)
  } catch (err) {
    // 上色失敗就維持純文字
    console.warn('syntax highlighting failed', err)
  }
})
</script>

<template>
  <div v-if="paste">
    <div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      <h1 class="font-mono text-lg font-semibold">{{ paste.code }}</h1>
      <UBadge v-if="paste.language && paste.language !== 'text'" color="neutral" variant="subtle">
        {{ paste.language }}
      </UBadge>
      <span class="text-sm text-muted">
        {{ lineCount }} 行 · <ExpiryText :expires-at="paste.expiresAt" />
      </span>

      <div class="ml-auto flex gap-2">
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-copy"
          label="複製"
          @click="copy(paste.content)"
        />
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-file-code"
          label="Raw"
          :to="rawUrl"
          target="_blank"
          external
        />
        <UButton icon="i-lucide-plus" label="新貼文" to="/" />
      </div>
    </div>

    <pre
      class="overflow-x-auto rounded-lg border border-default bg-elevated p-4 font-mono text-sm leading-relaxed"
    ><code v-if="highlighted" class="shiki-code" v-html="highlighted" /><template v-else>{{ paste.content }}</template></pre><!-- eslint-disable-line vue/no-v-html -- Shiki 輸出時已跳脫貼文內容 -->
  </div>
</template>

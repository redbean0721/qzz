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
let highlighting = false
async function highlightSource() {
  const current = paste.value
  if (highlighting || !current || !canHighlight(current.language, current.content)) return
  highlighting = true
  try {
    highlighted.value = await highlight(current.content, current.language)
  } catch (err) {
    // 上色失敗就維持純文字
    console.warn('syntax highlighting failed', err)
  }
}

// Markdown 貼文像 GitHub 一樣預設顯示預覽，可以切換成原始碼；預覽產生前（或失敗時）先顯示原始碼
const isMarkdown = computed(() => paste.value?.language === 'markdown')
const view = ref<'preview' | 'source'>('preview')
const viewTabs = [
  { label: '預覽', value: 'preview', icon: 'i-lucide-eye' },
  { label: '原始碼', value: 'source', icon: 'i-lucide-code' },
]
const rendered = shallowRef<RenderedMarkdown | null>(null)

onMounted(async () => {
  const current = paste.value
  if (!current) return
  if (!isMarkdown.value) return highlightSource()
  try {
    rendered.value = await renderMarkdown(current.content)
  } catch (err) {
    console.warn('markdown rendering failed', err)
    view.value = 'source'
  }
})

// 預覽裡的程式碼（utils/markdown.ts 標上 data-copy）：區塊右上角的按鈕、行內程式碼本身，點了就複製原始內容
function copyTarget(event: Event) {
  const target = (event.target as Element | null)?.closest<HTMLElement>('[data-copy]')
  if (!target) return null
  const text = rendered.value?.codes[Number(target.dataset.copy)]
  return text === undefined ? null : { target, text }
}

async function onPreviewClick(event: MouseEvent) {
  const hit = copyTarget(event)
  // 在行內程式碼上拖曳選取文字時不要複製
  if (!hit || (hit.target.tagName === 'CODE' && window.getSelection()?.toString())) return
  await copy(hit.text)
  hit.target.classList.add('copied')
  setTimeout(() => hit.target.classList.remove('copied'), 1500)
}

// 行內程式碼是 role="button" 的 <code>，鍵盤也要能觸發（<button> 本來就會）
function onPreviewKeydown(event: KeyboardEvent) {
  if ((event.key !== 'Enter' && event.key !== ' ') || (event.target as Element).tagName !== 'CODE') return
  if (!copyTarget(event)) return
  event.preventDefault()
  ;(event.target as HTMLElement).click()
}

// 原始碼只在切過去時才上色
watch(view, (value) => {
  if (value === 'source') highlightSource()
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

    <UTabs
      v-if="isMarkdown"
      v-model="view"
      :items="viewTabs"
      :content="false"
      variant="link"
      size="sm"
      class="mb-3 w-fit"
    />

    <!-- eslint-disable vue/no-v-html -- markdown-it 設定 html: false 並限制連結（utils/markdown.ts） -->
    <div
      v-if="isMarkdown && view === 'preview' && rendered"
      class="markdown-body prose prose-zinc max-w-none rounded-lg border border-default p-4 sm:p-6 dark:prose-invert"
      @click="onPreviewClick"
      @keydown="onPreviewKeydown"
      v-html="rendered.html"
    />
    <!-- eslint-enable vue/no-v-html -->
    <pre
      v-else
      class="overflow-x-auto rounded-lg border border-default bg-elevated p-4 font-mono text-sm leading-relaxed"
    ><code v-if="highlighted" class="shiki-code" v-html="highlighted" /><template v-else>{{ paste.content }}</template></pre><!-- eslint-disable-line vue/no-v-html -- Shiki 輸出時已跳脫貼文內容 -->
  </div>
</template>

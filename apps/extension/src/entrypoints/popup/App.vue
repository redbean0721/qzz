<script setup lang="ts">
import type { LinkResponse, PasteResponse } from '@qzz/shared'
import { FileText, Link } from 'lucide-vue-next'
import { onMounted, onUnmounted, ref, toRaw } from 'vue'
import { browser } from 'wxt/browser'
import HistoryList from '../../components/HistoryList.vue'
import LinkPanel from '../../components/LinkPanel.vue'
import PastePanel from '../../components/PastePanel.vue'
import ResultCard, { type Result } from '../../components/ResultCard.vue'
import { API_ORIGIN } from '../../utils/api'
import { pruneExpired, withAdded, withRemoved, type HistoryItem } from '../../utils/history'
import { historyItem, PENDING_TTL_MS, pendingItem, type Pending } from '../../utils/storage'

const tab = ref<'link' | 'paste'>('link')
const linkUrl = ref('')
const pasteContent = ref('')
const result = ref<Result | null>(null)
const history = ref<HistoryItem[]>([])
const unwatch: Array<() => void> = []

// 右鍵選單帶來的內容：切到對應的分頁並填好，使用者確認有效期限後再送出
async function applyPending(pending: Pending | null) {
  if (!pending || Date.now() - pending.at > PENDING_TTL_MS) return
  await pendingItem.removeValue()
  result.value = null
  if (pending.kind === 'link') {
    tab.value = 'link'
    linkUrl.value = pending.url
  } else {
    tab.value = 'paste'
    pasteContent.value = pending.content
  }
}

// storage 要存普通的陣列和物件：Vue 的響應式 Proxy 交給 storage.setValue 會被存成非陣列的東西
const plain = (items: HistoryItem[]): HistoryItem[] => items.map((item) => ({ ...toRaw(item) }))

async function loadHistory() {
  const stored = await historyItem.getValue()
  const active = pruneExpired(Array.isArray(stored) ? stored : [])
  if (active.length !== stored.length || !Array.isArray(stored)) await historyItem.setValue(plain(active))
  history.value = active
}

async function saveHistory(items: HistoryItem[]) {
  const next = plain(items)
  history.value = next
  await historyItem.setValue(next)
}

onMounted(async () => {
  await loadHistory()

  const pending = await pendingItem.getValue()
  if (pending && Date.now() - pending.at <= PENDING_TTL_MS) {
    await applyPending(pending)
  } else {
    // 預設帶入目前分頁的網址（只接受 http/https，chrome:// 之類的不帶）
    const [active] = await browser.tabs.query({ active: true, currentWindow: true })
    if (active?.url && /^https?:\/\//.test(active.url) && !active.url.startsWith(API_ORIGIN)) {
      linkUrl.value = active.url
    }
  }

  // 右鍵選單是先開彈出視窗才寫入內容，所以要繼續監聽
  unwatch.push(pendingItem.watch((value) => void applyPending(value)))
  unwatch.push(historyItem.watch((value) => (history.value = pruneExpired(Array.isArray(value) ? value : []))))
})

onUnmounted(() => unwatch.forEach((fn) => fn()))

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

async function onLinkCreated(res: LinkResponse) {
  await saveHistory(
    withAdded(history.value, {
      kind: 'link',
      code: res.code,
      url: res.shortUrl,
      target: res.url,
      deleteToken: res.deleteToken,
      expiresAt: res.expiresAt,
      createdAt: new Date().toISOString(),
    }),
  )
  result.value = { url: res.shortUrl, expiresAt: res.expiresAt, copied: await copy(res.shortUrl) }
  linkUrl.value = ''
}

async function onPasteCreated(res: PasteResponse) {
  await saveHistory(
    withAdded(history.value, {
      kind: 'paste',
      code: res.code,
      url: res.url,
      deleteToken: res.deleteToken,
      expiresAt: res.expiresAt,
      createdAt: new Date().toISOString(),
    }),
  )
  result.value = { url: res.url, rawUrl: res.rawUrl, expiresAt: res.expiresAt, copied: await copy(res.url) }
  pasteContent.value = ''
}

async function onCopy(text: string) {
  if (result.value && result.value.url === text) {
    result.value = { ...result.value, copied: await copy(text) }
  } else {
    await copy(text)
  }
}

const tabClass = (active: boolean) =>
  active
    ? 'bg-emerald-500 text-white'
    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
</script>

<template>
  <div class="p-4">
    <header class="mb-3 flex items-center justify-between">
      <a :href="API_ORIGIN" target="_blank" rel="noopener" class="font-mono text-lg font-bold">
        qzz<span class="text-emerald-500">.tw</span>
      </a>
    </header>

    <nav class="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1 text-sm font-medium dark:bg-zinc-800/60">
      <button
        type="button"
        class="flex items-center justify-center gap-1.5 rounded-md py-1.5"
        :class="tabClass(tab === 'link')"
        @click="tab = 'link'"
      >
        <Link class="size-4" /> 短網址
      </button>
      <button
        type="button"
        class="flex items-center justify-center gap-1.5 rounded-md py-1.5"
        :class="tabClass(tab === 'paste')"
        @click="tab = 'paste'"
      >
        <FileText class="size-4" /> 貼文
      </button>
    </nav>

    <LinkPanel v-show="tab === 'link'" v-model:url="linkUrl" @created="onLinkCreated" />
    <PastePanel v-show="tab === 'paste'" v-model:content="pasteContent" @created="onPasteCreated" />

    <ResultCard v-if="result" :result="result" @copy="onCopy" />

    <HistoryList
      :items="history"
      @copy="onCopy"
      @removed="(item) => saveHistory(withRemoved(history, item))"
    />
  </div>
</template>

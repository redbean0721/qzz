<script setup lang="ts">
import type { LinkResponse, PasteResponse } from '@qzz/shared'
import { FileText, Link } from 'lucide-vue-next'
import { onMounted, onUnmounted, ref } from 'vue'
import { browser } from 'wxt/browser'
import HistoryList from '../../components/HistoryList.vue'
import LinkPanel from '../../components/LinkPanel.vue'
import PastePanel from '../../components/PastePanel.vue'
import ResultCard, { type Result } from '../../components/ResultCard.vue'
import { API_ORIGIN } from '../../utils/api'
import { withAdded, withRemoved, type HistoryItem } from '../../utils/history'
import { PENDING_TTL_MS, pendingItem, type Pending } from '../../utils/pending'
import { historyItem, historyRemovedItem, updateHistory } from '../../utils/storage'

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

// 讀取（順便拿掉過期的）或變更紀錄，都從 storage 重新讀：qzz.tw 的 content script 隨時可能同步進新的項目。
// 依序執行，晚讀到的結果才不會被早一點的舊結果蓋掉
let historyQueue = Promise.resolve()
function refreshHistory(change?: Parameters<typeof updateHistory>[0]): Promise<void> {
  historyQueue = historyQueue
    .then(async () => {
      history.value = (await updateHistory(change)).items
    })
    .catch((err: unknown) => console.warn('qzz: history update failed', err))
  return historyQueue
}

// 在背景嵌入 qzz.tw 的空白頁，讓 content script 把網站建立的紀錄同步過來（結果從 storage 的變更通知拿到）。
// 等 load 之後才掛上：Chrome 要等彈出視窗的 load（含所有 iframe）才把視窗顯示出來，一開始就放會慢上幾百毫秒
const syncUrl = `${API_ORIGIN}/sync.html`
const syncing = ref(false)
function startSync() {
  if (document.readyState === 'complete') setTimeout(() => (syncing.value = true))
  else window.addEventListener('load', () => setTimeout(() => (syncing.value = true)), { once: true })
}

onMounted(async () => {
  // 先開始監聽再讀：同步用的 iframe 一掛上就在載入，可能在這裡 await 的期間就把網站的紀錄寫進來
  unwatch.push(historyItem.watch(() => void refreshHistory()))
  unwatch.push(historyRemovedItem.watch(() => void refreshHistory()))
  await refreshHistory()
  startSync()

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
  await refreshHistory((state) =>
    withAdded(state, {
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

async function onPasteCreated(res: PasteResponse & { burnAfterReading: boolean }) {
  await refreshHistory((state) =>
    withAdded(state, {
      kind: 'paste',
      code: res.code,
      url: res.url,
      deleteToken: res.deleteToken,
      expiresAt: res.expiresAt,
      createdAt: new Date().toISOString(),
      ...(res.burnAfterReading && { burnAfterReading: true }),
    }),
  )
  result.value = {
    url: res.url,
    // 閱後即焚的貼文沒有 raw
    rawUrl: res.burnAfterReading ? undefined : res.rawUrl,
    expiresAt: res.expiresAt,
    copied: await copy(res.url),
    burnAfterReading: res.burnAfterReading,
  }
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
      @removed="(item: HistoryItem) => refreshHistory((state) => withRemoved(state, item))"
    />

    <!-- 同步用，看不到也不能操作 -->
    <iframe v-if="syncing" :src="syncUrl" class="hidden" tabindex="-1" aria-hidden="true" title="sync" />
  </div>
</template>

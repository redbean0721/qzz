<script setup lang="ts">
import type { HistoryItem } from '~/composables/useHistory'

const { items, remove } = useHistory()
const copy = useCopy()
const toast = useToast()

const keyOf = (item: HistoryItem) => `${item.kind}:${item.code}`
// 刪除要按兩次：第一次進入確認狀態
const confirming = ref<string | null>(null)
const deleting = ref<string | null>(null)

async function onDelete(item: HistoryItem) {
  const key = keyOf(item)
  if (confirming.value !== key) {
    confirming.value = key
    return
  }

  confirming.value = null
  deleting.value = key
  try {
    await $fetch(`/v1/${item.kind === 'link' ? 'links' : 'pastes'}/${item.code}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${item.deleteToken}` },
    })
    remove(item)
    toast.add({ title: '已刪除', color: 'success' })
  } catch (err) {
    // 404：已過期、已被刪除或刪除碼不對，伺服器上都已經不存在（或刪不掉），從紀錄移除
    if ((err as { statusCode?: number }).statusCode === 404) {
      remove(item)
      toast.add({ title: '已不存在', description: '可能已過期或已被刪除，已從紀錄移除' })
    } else {
      toast.add({ title: '刪除失敗', description: apiErrorMessage(err), color: 'error' })
    }
  } finally {
    deleting.value = null
  }
}
</script>

<template>
  <section v-if="items.length > 0" class="mt-12">
    <h2 class="mb-3 text-sm font-semibold text-muted">這個瀏覽器建立過的</h2>

    <ul class="divide-y divide-default rounded-lg border border-default">
      <li v-for="item in items" :key="keyOf(item)" class="flex items-center gap-3 px-4 py-3">
        <UIcon
          :name="item.kind === 'link' ? 'i-lucide-link' : 'i-lucide-file-text'"
          class="size-5 shrink-0 text-muted"
        />

        <div class="min-w-0 flex-1">
          <a
            :href="item.url"
            target="_blank"
            rel="noopener"
            class="block truncate font-mono text-sm"
            :class="isExpired(item.expiresAt) ? 'text-dimmed line-through' : 'text-primary'"
          >
            {{ item.url }}
          </a>
          <p class="truncate text-xs text-muted">
            <template v-if="item.target">{{ item.target }} · </template>
            <ExpiryText :expires-at="item.expiresAt" />
          </p>
        </div>

        <template v-if="isExpired(item.expiresAt)">
          <UButton size="xs" color="neutral" variant="ghost" label="移除" @click="remove(item)" />
        </template>
        <template v-else>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            icon="i-lucide-copy"
            aria-label="複製"
            @click="copy(item.url)"
          />
          <UButton
            size="xs"
            color="error"
            :variant="confirming === keyOf(item) ? 'solid' : 'ghost'"
            :icon="confirming === keyOf(item) ? undefined : 'i-lucide-trash-2'"
            :label="confirming === keyOf(item) ? '確定刪除？' : undefined"
            :aria-label="confirming === keyOf(item) ? undefined : '刪除'"
            :loading="deleting === keyOf(item)"
            @click="onDelete(item)"
            @blur="confirming === keyOf(item) && (confirming = null)"
          />
        </template>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { createLinkSchema, type ExpiresIn, type LinkResponse } from '@qzz/shared'

const state = reactive<{ url: string; expiresIn: ExpiresIn }>({ url: '', expiresIn: '1d' })
const loading = ref(false)
const result = ref<LinkResponse | null>(null)

const history = useHistory()
const toast = useToast()
const copy = useCopy()
const { settings } = useSettings()

// 設定在掛載後才讀到（擴充功能同步過來時也會變）：跟著換預設值。immediate：分頁切過來才掛載的表單
// 要直接套用已經讀到的設定（SSR 和 hydration 時是預設值，畫面不會不一致）
watch(
  () => settings.value.linkExpiresIn,
  (value) => (state.expiresIn = value),
  { immediate: true },
)

async function onSubmit() {
  loading.value = true
  try {
    const res = await $fetch<LinkResponse>('/v1/links', { method: 'POST', body: state })
    result.value = res
    history.add({
      kind: 'link',
      code: res.code,
      url: res.shortUrl,
      target: res.url,
      deleteToken: res.deleteToken,
      expiresAt: res.expiresAt,
    })
    state.url = ''
    if (settings.value.autoCopy) await copy(res.shortUrl, '已複製短網址', { quiet: true })
  } catch (err) {
    toast.add({ title: '建立失敗', description: apiErrorMessage(err), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UForm :schema="createLinkSchema" :state="state" class="space-y-4" @submit="onSubmit">
    <UFormField label="網址" name="url">
      <UInput v-model="state.url" placeholder="https://example.com/很長的網址" size="lg" class="w-full" autofocus />
    </UFormField>

    <div class="flex items-end gap-3">
      <UFormField label="有效期限" name="expiresIn">
        <USelect v-model="state.expiresIn" :items="expiresOptions" class="w-32" />
      </UFormField>
      <UButton type="submit" icon="i-lucide-scissors" label="縮短" size="lg" :loading="loading" class="ml-auto" />
    </div>
  </UForm>

  <CreatedResult
    v-if="result"
    :url="result.shortUrl"
    :delete-token="result.deleteToken"
    :expires-at="result.expiresAt"
    :preview-url="`${result.shortUrl}+`"
  />
</template>

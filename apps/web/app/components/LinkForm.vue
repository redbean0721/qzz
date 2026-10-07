<script setup lang="ts">
import { createLinkSchema, type ExpiresIn, type LinkResponse } from '@qzz/shared'

const state = reactive<{ url: string; expiresIn: ExpiresIn }>({ url: '', expiresIn: '1d' })
const loading = ref(false)
const result = ref<LinkResponse | null>(null)

const history = useHistory()
const toast = useToast()

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
  />
</template>

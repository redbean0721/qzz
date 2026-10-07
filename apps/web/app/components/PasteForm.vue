<script setup lang="ts">
import {
  MAX_PASTE_BYTES,
  PASTE_LANGUAGES,
  createPasteSchema,
  type ExpiresIn,
  type PasteResponse,
} from '@qzz/shared'

const LANGUAGES = PASTE_LANGUAGES.map((value) => ({ label: value === 'text' ? '純文字' : value, value }))

const state = reactive<{ content: string; language: (typeof PASTE_LANGUAGES)[number]; expiresIn: ExpiresIn }>({
  content: '',
  language: 'text',
  expiresIn: '30d',
})
const loading = ref(false)
const result = ref<PasteResponse | null>(null)

const history = useHistory()
const toast = useToast()

const encoder = new TextEncoder()
const bytes = computed(() => encoder.encode(state.content).length)
const formatKB = (n: number) => `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`

async function onSubmit() {
  loading.value = true
  try {
    const res = await $fetch<PasteResponse>('/v1/pastes', { method: 'POST', body: state })
    result.value = res
    history.add({
      kind: 'paste',
      code: res.code,
      url: res.url,
      deleteToken: res.deleteToken,
      expiresAt: res.expiresAt,
    })
    state.content = ''
  } catch (err) {
    toast.add({ title: '建立失敗', description: apiErrorMessage(err), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UForm :schema="createPasteSchema" :state="state" class="space-y-4" @submit="onSubmit">
    <UFormField label="內容" name="content">
      <template #hint>
        <span :class="bytes > MAX_PASTE_BYTES ? 'text-error' : ''">
          {{ formatKB(bytes) }} / {{ formatKB(MAX_PASTE_BYTES) }}
        </span>
      </template>
      <UTextarea
        v-model="state.content"
        :rows="12"
        placeholder="貼上文字或程式碼"
        class="w-full"
        :ui="{ base: 'font-mono text-sm' }"
      />
    </UFormField>

    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="語言" name="language">
        <USelect v-model="state.language" :items="LANGUAGES" class="w-36" />
      </UFormField>
      <UFormField label="有效期限" name="expiresIn">
        <USelect v-model="state.expiresIn" :items="expiresOptions" class="w-32" />
      </UFormField>
      <UButton type="submit" icon="i-lucide-send" label="建立貼文" size="lg" :loading="loading" class="ml-auto" />
    </div>
  </UForm>

  <CreatedResult
    v-if="result"
    :url="result.url"
    :raw-url="result.rawUrl"
    :delete-token="result.deleteToken"
    :expires-at="result.expiresAt"
  />
</template>

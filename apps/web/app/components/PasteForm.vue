<script setup lang="ts">
import {
  MAX_PASTE_BYTES,
  PASTE_LANGUAGES,
  createPasteSchema,
  type ExpiresIn,
  type PasteResponse,
} from '@qzz/shared'

const LANGUAGES = PASTE_LANGUAGES.map((value) => ({ label: value === 'text' ? '純文字' : value, value }))

const state = reactive<{
  content: string
  language: (typeof PASTE_LANGUAGES)[number]
  expiresIn: ExpiresIn
  burnAfterReading: boolean
}>({
  content: '',
  language: 'text',
  expiresIn: '1d',
  burnAfterReading: false,
})
const loading = ref(false)
const result = ref<(PasteResponse & { burnAfterReading: boolean }) | null>(null)

const history = useHistory()
const toast = useToast()
const copy = useCopy()
const { settings } = useSettings()

// 設定在掛載後才讀到（擴充功能同步過來時也會變）：跟著換預設值。immediate：分頁切過來才掛載的表單
// 要直接套用已經讀到的設定（SSR 和 hydration 時是預設值，畫面不會不一致）。設定裡的語言這個版本不認得就用純文字
const isLanguage = (value: string): value is (typeof PASTE_LANGUAGES)[number] =>
  (PASTE_LANGUAGES as readonly string[]).includes(value)
watch(
  () => settings.value.pasteLanguage,
  (value) => (state.language = isLanguage(value) ? value : 'text'),
  { immediate: true },
)
watch(
  () => settings.value.pasteExpiresIn,
  (value) => (state.expiresIn = value),
  { immediate: true },
)
watch(
  () => settings.value.burnAfterReading,
  (value) => (state.burnAfterReading = value),
  { immediate: true },
)

const encoder = new TextEncoder()
const bytes = computed(() => encoder.encode(state.content).length)
const formatKB = (n: number) => `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`

async function onSubmit() {
  loading.value = true
  try {
    const res = await $fetch<PasteResponse>('/v1/pastes', { method: 'POST', body: state })
    result.value = { ...res, burnAfterReading: state.burnAfterReading }
    history.add({
      kind: 'paste',
      code: res.code,
      url: res.url,
      deleteToken: res.deleteToken,
      expiresAt: res.expiresAt,
      ...(state.burnAfterReading && { burnAfterReading: true }),
    })
    state.content = ''
    if (settings.value.autoCopy) await copy(res.url, '已複製貼文網址', { quiet: true })
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
      <UFormField name="burnAfterReading" class="pb-2">
        <UCheckbox v-model="state.burnAfterReading" label="閱後即焚" description="第一次打開就刪除" />
      </UFormField>
      <UButton type="submit" icon="i-lucide-send" label="建立貼文" size="lg" :loading="loading" class="ml-auto" />
    </div>
  </UForm>

  <CreatedResult
    v-if="result"
    :url="result.url"
    :raw-url="result.burnAfterReading ? undefined : result.rawUrl"
    :delete-token="result.deleteToken"
    :expires-at="result.expiresAt"
    :burn-after-reading="result.burnAfterReading"
  />
</template>

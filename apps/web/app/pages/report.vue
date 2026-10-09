<script setup lang="ts">
import type { FormError } from '@nuxt/ui'
import {
  MAX_REPORT_DETAILS,
  REPORT_REASONS,
  REPORT_REASON_LABELS,
  parseContentUrl,
  type ReportReason,
} from '@qzz/shared'

useSeoMeta({
  title: '檢舉濫用 – qzz',
  description: '檢舉被用來釣魚、散布惡意程式、垃圾訊息或違法內容的 qzz.tw 短網址或貼文。',
})

const REASONS = REPORT_REASONS.map((value) => ({ label: REPORT_REASON_LABELS[value], value }))

// 只接受這個網站的網址（正式環境 qzz.tw，本機開發是 localhost）
const { host, origin } = useRequestURL()
const route = useRoute()
// 貼文頁的「檢舉」按鈕會帶 ?url=
const prefill = typeof route.query.url === 'string' ? route.query.url : ''

const state = reactive<{ url: string; reason: ReportReason | undefined; details: string }>({
  url: prefill,
  reason: undefined,
  details: '',
})
const loading = ref(false)
const submitted = ref(false)
const form = useTemplateRef('form')
const toast = useToast()

const URL_ERROR = `請輸入這個網站的短網址或貼文網址，例如 ${origin}/abc1234`

function validate(): FormError[] {
  const errors: FormError[] = []
  if (!state.url.trim()) errors.push({ name: 'url', message: '請輸入要檢舉的網址' })
  else if (!parseContentUrl(state.url, host)) errors.push({ name: 'url', message: URL_ERROR })
  if (!state.reason) errors.push({ name: 'reason', message: '請選擇檢舉原因' })
  if (state.details.trim().length > MAX_REPORT_DETAILS) {
    errors.push({ name: 'details', message: `補充說明不可超過 ${MAX_REPORT_DETAILS} 字` })
  }
  return errors
}

async function onSubmit() {
  const target = parseContentUrl(state.url, host)
  if (!target || !state.reason) return

  loading.value = true
  try {
    await $fetch('/v1/reports', {
      method: 'POST',
      body: { ...target, reason: state.reason, details: state.details.trim() || undefined },
    })
    submitted.value = true
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) {
      form.value?.setErrors([{ name: 'url', message: '找不到這個短網址或貼文，可能已經過期或被刪除' }], 'url')
    } else {
      toast.add({ title: '送出失敗', description: apiErrorMessage(err), color: 'error' })
    }
  } finally {
    loading.value = false
  }
}

function reset() {
  Object.assign(state, { url: '', reason: undefined, details: '' })
  submitted.value = false
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold">檢舉濫用</h1>
    <p class="mt-2 text-sm leading-6 text-muted">
      發現 qzz.tw 的短網址或貼文被用來釣魚、詐騙、散布惡意程式、垃圾訊息或違法內容，請告訴我們。每一則檢舉都由管理員人工審核，確認違規後會下架。
    </p>

    <UAlert
      v-if="submitted"
      class="mt-6"
      color="success"
      variant="subtle"
      icon="i-lucide-circle-check"
      title="已收到檢舉，謝謝你的回報"
      description="我們會盡快審核。審核結果不會另行通知。"
      :actions="[{ label: '檢舉其他網址', color: 'neutral', variant: 'outline', onClick: reset }]"
    />

    <!-- 不在 blur 時驗證：按「送出檢舉」時輸入框先 blur，錯誤訊息把按鈕往下推，滑鼠放開時就不在按鈕上，送出會被吃掉 -->
    <UForm
      v-else
      ref="form"
      :validate="validate"
      :validate-on="['input', 'change']"
      :state="state"
      class="mt-6 space-y-5"
      @submit="onSubmit"
    >
      <UFormField label="網址" name="url" description="短網址、貼文或 Raw 的網址都可以">
        <UInput v-model="state.url" :placeholder="`${origin}/abc1234`" size="lg" class="w-full" :autofocus="!prefill" />
      </UFormField>

      <UFormField label="原因" name="reason">
        <URadioGroup v-model="state.reason" :items="REASONS" />
      </UFormField>

      <UFormField label="補充說明" name="details" hint="選填">
        <UTextarea
          v-model="state.details"
          :maxlength="MAX_REPORT_DETAILS"
          :rows="4"
          placeholder="例如：假冒了哪個網站、在哪裡看到這個連結"
          class="w-full"
        />
      </UFormField>

      <div class="flex flex-wrap items-center gap-3">
        <p class="flex-1 text-xs text-muted">
          送出時會記錄你的 IP 位址，用來避免重複或惡意檢舉，詳見<NuxtLink to="/privacy" class="underline">隱私權政策</NuxtLink>。
        </p>
        <UButton type="submit" icon="i-lucide-flag" label="送出檢舉" size="lg" :loading="loading" />
      </div>
    </UForm>
  </div>
</template>

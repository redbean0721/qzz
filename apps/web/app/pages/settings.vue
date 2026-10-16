<script setup lang="ts">
import { DEFAULT_SETTINGS, PASTE_LANGUAGES, SETTING_KEYS, type ExpiresIn } from '@qzz/shared'

useSeoMeta({
  title: '設定 – qzz',
  description: 'qzz.tw 的偏好設定：預設有效期限、貼文語言、自動複製和閱後即焚。',
  robots: 'noindex',
})

const LANGUAGES = PASTE_LANGUAGES.map((value) => ({ label: value === 'text' ? '純文字' : value, value }))

const { settings, set } = useSettings()

// 設定裡的語言可能是擴充功能從 API 拿到、這個版本還不認得的語言：選單上顯示成純文字
type Language = (typeof PASTE_LANGUAGES)[number]
const language = computed<Language>(() =>
  (PASTE_LANGUAGES as readonly string[]).includes(settings.value.pasteLanguage)
    ? (settings.value.pasteLanguage as Language)
    : 'text',
)

const isDefault = computed(() => SETTING_KEYS.every((key) => settings.value[key] === DEFAULT_SETTINGS[key]))

function resetAll() {
  for (const key of SETTING_KEYS) set(key, DEFAULT_SETTINGS[key])
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold">設定</h1>
    <p class="mt-2 text-sm leading-6 text-muted">
      變更會立即儲存在這個瀏覽器。裝了 qzz 擴充功能的話，會跟擴充功能的設定自動同步。
    </p>

    <!-- 設定存在 localStorage，伺服器端不知道 -->
    <ClientOnly>
      <div class="mt-8 space-y-8">
        <section>
          <h2 class="mb-3 text-sm font-semibold text-muted">短網址</h2>
          <UFormField label="預設有效期限">
            <USelect
              :model-value="settings.linkExpiresIn"
              :items="expiresOptions"
              class="w-32"
              @update:model-value="(value: ExpiresIn) => set('linkExpiresIn', value)"
            />
          </UFormField>
        </section>

        <section class="space-y-4">
          <h2 class="text-sm font-semibold text-muted">貼文</h2>
          <div class="flex flex-wrap gap-4">
            <UFormField label="預設有效期限">
              <USelect
                :model-value="settings.pasteExpiresIn"
                :items="expiresOptions"
                class="w-32"
                @update:model-value="(value: ExpiresIn) => set('pasteExpiresIn', value)"
              />
            </UFormField>
            <UFormField label="預設語言">
              <USelect
                :model-value="language"
                :items="LANGUAGES"
                class="w-36"
                @update:model-value="(value: Language) => set('pasteLanguage', value)"
              />
            </UFormField>
          </div>
          <UCheckbox
            :model-value="settings.burnAfterReading"
            label="預設勾選閱後即焚"
            description="建立貼文時預設勾選，第一次打開就刪除"
            @update:model-value="(value) => set('burnAfterReading', value === true)"
          />
        </section>

        <section>
          <h2 class="mb-3 text-sm font-semibold text-muted">建立之後</h2>
          <USwitch
            :model-value="settings.autoCopy"
            label="自動複製網址"
            description="建立短網址或貼文後，自動把網址複製到剪貼簿"
            @update:model-value="(value: boolean) => set('autoCopy', value)"
          />
        </section>

        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-rotate-ccw"
          label="恢復預設值"
          :disabled="isDefault"
          @click="resetAll"
        />
      </div>
    </ClientOnly>
  </div>
</template>

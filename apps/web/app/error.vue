<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const notFound = computed(() => props.error.statusCode === 404)

useSeoMeta({
  title: notFound.value ? '找不到頁面 – qzz' : '發生錯誤 – qzz',
  robots: 'noindex',
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <div class="py-16 text-center">
        <p class="font-mono text-5xl font-bold text-primary">{{ error.statusCode }}</p>
        <h1 class="mt-4 text-xl font-semibold">
          {{ notFound ? '找不到這個頁面' : '發生錯誤' }}
        </h1>
        <p class="mt-2 text-muted">
          {{ notFound ? '連結可能打錯了，或已經過期、被刪除。' : '請稍後再試。' }}
        </p>
        <UButton class="mt-8" icon="i-lucide-house" label="回首頁" @click="clearError({ redirect: '/' })" />
      </div>
    </NuxtLayout>
  </UApp>
</template>

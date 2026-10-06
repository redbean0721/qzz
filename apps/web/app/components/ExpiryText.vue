<script setup lang="ts">
defineProps<{ expiresAt: string | null }>()
</script>

<template>
  <span v-if="expiresAt === null">永久有效</span>
  <span v-else-if="isExpired(expiresAt)">已過期</span>
  <span v-else>
    到期：<NuxtTime :datetime="expiresAt" locale="zh-TW" date-style="medium" time-style="short" />
  </span>
</template>

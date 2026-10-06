// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/eslint', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],

  app: {
    head: {
      htmlAttrs: { lang: 'zh-Hant-TW' },
      title: 'qzz – 短網址與貼文',
    },
  },

  runtimeConfig: {
    // 伺服器端（SSR、短網址轉發）連 API 用，不會送到瀏覽器。
    // 正式環境設 NUXT_API_BASE=https://qzz.tw：Worker 對同一個 zone 的請求不會再進 Worker，
    // /v1/* 會直接到 Tunnel 後面的 API
    apiBase: 'http://localhost:3001',
  },

  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      // build 時在 .output 產生 wrangler.json（含 nodejs_compat），部署時直接用
      deployConfig: true,
      nodeCompat: true,
    },
  },

  // 正式環境的 /v1/* 由 Cloudflare 直接送到 API，不會進 Nuxt；dev 用 proxy 模擬
  $development: {
    routeRules: {
      '/v1/**': { proxy: 'http://localhost:3001/v1/**' },
    },
  },
})

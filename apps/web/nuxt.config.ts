// https://nuxt.com/docs/api/configuration/nuxt-config
import { join } from 'node:path'
import { createNoticeCollector } from '../../tools/third-party-notices'

// 送到使用者瀏覽器的是 client bundle：只收集它打包的套件，寫成 /third-party-notices.txt
const notices = createNoticeCollector({
  title: 'qzz.tw – third-party notices',
  note: 'Covers the JavaScript and CSS served to the browser (the client bundle).',
  // 不在 JS 模組清單裡、但產物裡有它們的東西：Tailwind 產生的 CSS（透過 Nuxt UI，Markdown 預覽用 typography 外掛），
  // 以及 Nuxt Icon 從 @iconify-json/lucide 讀出、以虛擬模組打包的圖示資料
  alwaysInclude: ['tailwindcss', '@tailwindcss/typography', '@iconify-json/lucide'],
})

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

  vite: {
    plugins: [notices.vitePlugin((environment) => environment === undefined || environment === 'client')],
  },

  hooks: {
    // client 已經 build 完、Nitro 正在複製 public 檔案的時候寫進去
    'nitro:build:public-assets'(nitro) {
      notices.write(join(nitro.options.output.publicDir, 'third-party-notices.txt'))
    },
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

import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'
import { createNoticeCollector } from '../../tools/third-party-notices'

const notices = createNoticeCollector({
  title: 'qzz browser extension – third-party notices',
  note: 'The extension icon is adapted from the "link" icon of Lucide (ISC License, see lucide-vue-next below).',
  // popup 的 CSS 由 Tailwind 產生（含 preflight），不在 JS 模組清單裡
  alwaysInclude: ['tailwindcss'],
})

// 開發時連本機的 Nuxt（它會把 /v1 轉給 :3001 的 API），正式 build 連 qzz.tw
const API_ORIGIN = {
  development: 'http://localhost:3000',
  production: 'https://qzz.tw',
}

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-vue', '@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
  },
  hooks: {
    // WXT 會把彈出視窗和背景程式分開 build；全部 build 完後合併每一步打包的模組，寫進輸出目錄（zip 也會包含）
    'build:done': (wxt, output) => {
      for (const step of output.steps) {
        for (const chunk of step.chunks) {
          if (chunk.type === 'chunk') notices.add(chunk.moduleIds)
        }
      }
      notices.write(join(wxt.config.outDir, 'THIRD_PARTY_NOTICES.txt'))
    },
  },
  zip: {
    // qzz-0.1.0-chrome.zip（預設會從 @qzz/extension 變成 qzzextension）
    name: 'qzz',
    // Firefox 審核要能從原始碼重新 build：從 monorepo 根目錄打包擴充功能和它用到的 shared，
    // 其他 workspace 只放 package.json（yarn 要靠它們對齊 lockfile）
    sourcesRoot: '../..',
    dotSources: true,
    includeSources: [
      'package.json',
      'yarn.lock',
      '.yarnrc.yml',
      '.node-version',
      'apps/extension/**',
      'packages/shared/**',
      'tools/**',
      'apps/api/package.json',
      'apps/web/package.json',
    ],
    excludeSources: ['**/node_modules/**', '**/.output/**', '**/.wxt/**', '**/dist/**', '**/.env*'],
  },
  // Chrome / Edge 用 MV3；Firefox 用 WXT 預設的 MV2（MV3 的網站權限要使用者另外手動允許）
  manifest: ({ browser, mode }) => {
    const origin = mode === 'development' ? API_ORIGIN.development : API_ORIGIN.production
    return {
      name: 'qzz – 短網址與貼文',
      description: '一鍵縮短目前分頁的網址，或把選取的文字建立成貼文。',
      // scripting：右鍵建立貼文時讀取原始選取文字（保留換行）；Firefox MV2 改用 tabs.executeScript
      permissions: ['activeTab', 'contextMenus', 'storage', 'clipboardWrite', ...(browser === 'firefox' ? [] : ['scripting'])],
      host_permissions: [`${origin}/*`],
      action: { default_title: 'qzz – 短網址與貼文' },
      ...(browser === 'firefox' && {
        browser_specific_settings: {
          gecko: {
            id: 'extension@qzz.tw',
            // 內建的資料收集同意畫面（data_collection_permissions）從 Firefox 140 才有；
            // 支援更舊的版本就得自己做一個安裝後跳出的同意畫面
            strict_min_version: '140.0',
            // 使用者送出的網址（browsingActivity）和選取的文字（websiteContent）會傳到 qzz.tw
            data_collection_permissions: { required: ['browsingActivity', 'websiteContent'] },
          },
        },
      }),
    }
  },
  vite: ({ mode }) => ({
    plugins: [tailwindcss()],
    define: {
      __API_ORIGIN__: JSON.stringify(mode === 'development' ? API_ORIGIN.development : API_ORIGIN.production),
    },
  }),
})

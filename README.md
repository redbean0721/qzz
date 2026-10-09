# qzz – Shorten & Paste

[qzz.tw](https://qzz.tw) 是免登入的短網址與文字貼上服務，另外提供 Chrome / Edge 與 Firefox 的瀏覽器擴充功能。

- **短網址**：`qzz.tw/<code>`，可設定有效期限（1 小時到永久），建立前會用 Google Safe Browsing 檢查網址
- **貼文**：`qzz.tw/p/<code>`，最大 512 KB，支援語法高亮與純文字（raw）網址
- **免登入**：建立時會拿到一次性的刪除碼，可以隨時刪除自己建立的內容
- **瀏覽器擴充功能**：一鍵縮短目前分頁、右鍵縮短連結、把選取的文字建立成貼文
  - Firefox：[addons.mozilla.org/firefox/addon/qzz](https://addons.mozilla.org/firefox/addon/qzz/)（審核中）
  - Chrome / Edge：[Chrome 線上應用程式商店](https://chromewebstore.google.com/detail/mjoadeofebgfmgoolhccpefhjicjgpac)（審核中）

[隱私權政策](https://qzz.tw/privacy) · [開放原始碼授權](https://qzz.tw/third-party-notices.txt) · [回報問題](https://github.com/redbean0721/qzz/issues)

## 架構

整個服務只用一個網域，依路徑分流：

```
qzz.tw/v1/*      → API（Fastify）
qzz.tw/<code>    → 網站（Nuxt）→ 向 API 查詢後回 302
qzz.tw/p/<code>  → 網站（Nuxt SSR）→ 向 API 取得貼文
qzz.tw/*         → 網站（Nuxt 頁面與靜態檔）
```

| 部分 | 技術 |
|---|---|
| 網站 | Nuxt 4、Nuxt UI 4（Tailwind CSS 4）、Shiki |
| API | Fastify 5、TypeScript、Drizzle ORM，部署在 k3s（ArgoCD） |
| 資料 | PostgreSQL 18、Valkey 8（頻率限制、排程鎖） |
| 共用 | zod 4 schema 與型別（`@qzz/shared`），網站、API、擴充功能共用同一套驗證 |
| 擴充功能 | WXT、Vue 3、Tailwind CSS 4；同一份程式碼產生 Chrome（MV3）與 Firefox（MV2）版本 |

## 目錄

```
apps/web          Nuxt 網站（@qzz/web）
apps/api          Fastify API（@qzz/api）
apps/extension    瀏覽器擴充功能（@qzz/extension），說明見 apps/extension/README.md
packages/shared   共用的 zod schema 與型別（@qzz/shared）
tools/            建置與 git hook 用的腳本（授權聲明、依賴宣告檢查、pre-commit）
deploy/           開發用的 docker compose、k3s manifests、ArgoCD 設定，說明見 deploy/README.md
```

## 本機開發

需要：Node.js 24（見 `.node-version`）、Docker。Yarn 4 透過 Corepack 提供，不用另外安裝。

```sh
corepack enable
yarn install                                  # 也會設定好 commit 前的檢查（husky）
cp apps/api/.env.example apps/api/.env
yarn db:up                                    # 啟動 PostgreSQL 與 Valkey（只綁定 127.0.0.1）
yarn workspace @qzz/api migrate               # 建立資料表
yarn build:shared                             # 共用的 schema 要先 build
```

接著開兩個終端機：

```sh
yarn dev:api    # API：http://localhost:3001
yarn dev:web    # 網站：http://localhost:3000（會把 /v1/* 轉給 API，跟正式環境的分流一樣）
```

打開 <http://localhost:3000> 就能使用。`apps/api/.env` 的 `PUBLIC_BASE_URL` 預設是 `http://localhost:3000`，建立出來的短網址會指向本機的網站。

想在本機測試 Safe Browsing，在 `apps/api/.env` 加上 `SAFE_BROWSING_API_KEY`；沒有設定時會跳過檢查。

### 擴充功能

```sh
yarn workspace @qzz/extension build --mode development   # 連到 http://localhost:3000 的開發版
```

再到瀏覽器載入 `apps/extension/.output/chrome-mv3-dev`（Chrome：`chrome://extensions` → 開發人員模式 → 載入未封裝項目）。詳細步驟和 Firefox 的載入方式見 [apps/extension/README.md](apps/extension/README.md)。

### 常用指令

| 指令 | 說明 |
|---|---|
| `yarn workspace @qzz/api test` | API 測試（需要 `yarn db:up`） |
| `yarn workspace @qzz/<api\|web\|extension> typecheck` | 型別檢查 |
| `yarn workspace @qzz/web lint` | 網站的 ESLint |
| `yarn workspace @qzz/extension test` | 擴充功能的單元測試 |
| `yarn check:deps` | 確認每個 workspace 都宣告了自己用到的套件 |
| `yarn db:generate` | 修改 `apps/api/src/db/schema.ts` 後產生 migration |
| `yarn db:studio` | 用 Drizzle Studio 查看資料庫 |
| `yarn build:ext` / `yarn zip:ext` | 建置 / 打包 Chrome 與 Firefox 版擴充功能 |
| `yarn db:down` | 停止 PostgreSQL 與 Valkey |

### commit 前的檢查

`yarn install` 後會自動啟用 git hook。每次 commit 時，只會檢查這次暫存的檔案影響到的 workspace：

- 依賴宣告檢查：每個 `import` 的套件都要寫在那個 workspace 自己的 `package.json`（CI 和 Docker 只安裝部分 workspace，沒宣告的套件在那裡會找不到）
- 型別檢查、lint、單元測試
- API 測試：只有在 `apps/api/.env` 存在、而且 PostgreSQL 與 Valkey 有啟動時才會跑
- 修改了 GitHub Actions workflow 時，用 actionlint 檢查（需要 Docker）

只改文件時不會做任何檢查。真的需要略過時，用 `git commit --no-verify`。

## API

所有路徑都在 `/v1` 底下；建立、刪除與檢舉依 IP 限制頻率。

| 方法 | 路徑 | 說明 |
|---|---|---|
| `POST` | `/v1/links` | 建立短網址：`{ "url": "https://…", "expiresIn": "1h" \| "1d" \| "7d" \| "30d" \| "never" }` |
| `GET` | `/v1/links/:code` | 302 轉址到原始網址 |
| `GET` | `/v1/links/:code/info` | 取得目的地（JSON，不轉址；`qzz.tw/<code>+` 預覽頁用） |
| `DELETE` | `/v1/links/:code` | 刪除，需要 `Authorization: Bearer <deleteToken>` |
| `POST` | `/v1/pastes` | 建立貼文：`{ "content": "…", "language": "typescript", "expiresIn": "7d" }` |
| `GET` | `/v1/pastes/:code` | 取得貼文（JSON） |
| `GET` | `/v1/pastes/:code/raw` | 純文字內容 |
| `DELETE` | `/v1/pastes/:code` | 刪除，需要 `Authorization: Bearer <deleteToken>` |
| `POST` | `/v1/reports` | 檢舉：`{ "kind": "link" \| "paste", "code": "…", "reason": "phishing" \| "malware" \| "spam" \| "illegal" \| "other", "details": "…" }`，成功回 204，找不到內容回 404 |

`expiresIn` 省略時預設為 `1d`。建立成功時回傳的 `deleteToken` 只會出現這一次，伺服器只保存它的雜湊值。

## 部署

- **網站**：push 到 `main` 後自動建置與部署
- **API**：GitHub Actions 測試後建置 amd64 / arm64 映像檔推到 GHCR，再把新的映像檔標籤 commit 回 `deploy/k8s/deployment.yaml`，由 ArgoCD 同步到 k3s。資料庫 migration 在 Pod 啟動前自動執行
- **擴充功能**：推上 `extension-v<版本>` tag 後，GitHub Actions 打包 Chrome、Firefox 與原始碼 zip，建立 GitHub Release，並自動送到 Chrome 線上應用程式商店與 Firefox Add-ons 審核（設定見 [apps/extension/README.md](apps/extension/README.md#release)）

API 每次部署都會在 `main` 多一個 `deploy:` commit，push 前記得先 `git pull`。k3s 的部署設定見 [deploy/README.md](deploy/README.md)。

## 隱私與防濫用

- 會保存哪些資料、保存多久，見[隱私權政策](https://qzz.tw/privacy)
- 建立短網址前用 Google Safe Browsing 檢查，已知的釣魚與惡意網站無法縮短
- 建立、刪除與檢舉依 IP 限制頻率
- 發現濫用的短網址或貼文，請到 [qzz.tw/report](https://qzz.tw/report) 檢舉
- 檢舉由管理員人工審核，違規內容會被下架（停止公開但保留紀錄），不會因為檢舉自動下架

## 授權

[MIT](LICENSE) © 2026 redbean0721

網站與擴充功能打包的第三方套件授權，見 [qzz.tw/third-party-notices.txt](https://qzz.tw/third-party-notices.txt) 與擴充功能內的 `THIRD_PARTY_NOTICES.txt`。

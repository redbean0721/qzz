# qzz browser extension

One codebase ([WXT](https://wxt.dev) + Vue) built for Chrome / Edge (Manifest V3) and Firefox (Manifest V2).

- **Popup**: shorten the current tab's URL or create a paste; the result is copied automatically.
  History of what this extension created (with delete tokens) lives in `storage.local`; expired items are pruned.
- **Context menu**: "縮短這個連結" (links), "縮短這個網頁" (pages), "把選取的文字建立成貼文" (selection).
  The menu only fills the popup; the user still picks the expiry and submits.
- Talks to `https://qzz.tw/v1/*` in production builds and `http://localhost:3000/v1/*` in development
  builds (Nuxt dev server, which proxies `/v1` to the API on :3001).

## Develop

```sh
yarn build:shared
yarn workspace @qzz/extension build --mode development     # → .output/chrome-mv3-dev
yarn workspace @qzz/extension test                          # pure logic (node:test)
yarn workspace @qzz/extension typecheck
```

Run the API (`PUBLIC_BASE_URL=http://localhost:3000`) and `yarn dev:web`, then load the dev build:

- **Chrome / Edge**: `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/.output/chrome-mv3-dev`
- **Firefox**: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
  `apps/extension/.output/firefox-mv2-dev/manifest.json` (build it with `--mode development -b firefox`)

`yarn dev:ext` (`wxt` dev server with auto-reload) tries to launch a browser with the extension; branded Chrome
137+ ignores `--load-extension`, so if no extension shows up, use the manual load above.

## Release

1. Bump `version` in `package.json` (stores reject a version they already have) and push to `main`.
2. The **Extension** workflow (`.github/workflows/extension.yml`, also runnable by hand) typechecks, tests and
   builds, then attaches three artifacts to the run, each uploaded as-is (no extra zip layer):
   `qzz-<version>-firefox.zip`, `qzz-<version>-sources.zip`, `qzz-<version>-chrome.zip` (kept 30 days).
3. Download them from the run page and upload to the stores by hand.

Locally the same files come from `yarn zip:ext` (→ `apps/extension/.output/`).

- **Chrome Web Store** (one-time US$5 developer registration): upload the chrome zip. Edge Add-ons accepts the
  same zip (free).
- **Firefox Add-ons** (free): upload the firefox zip and the sources zip (AMO reviewers rebuild from source).
  The sources zip is the monorepo subset the extension needs; reviewer build steps (Node 24, Yarn via Corepack):

  ```sh
  corepack enable
  yarn workspaces focus @qzz/extension @qzz/shared
  yarn build:shared
  yarn workspace @qzz/extension build:firefox   # → apps/extension/.output/firefox-mv2
  ```

  The manifest declares `data_collection_permissions: browsingActivity, websiteContent` because the URLs and
  selected text the user submits are sent to qzz.tw, and `strict_min_version: 140.0` (Firefox's built-in data
  consent prompt starts at 140; older versions would need our own consent screen). Choose **Firefox desktop
  only** on AMO: Firefox for Android has no context menus or `windows` API.

Permissions: `activeTab` (current tab URL), `contextMenus`, `storage`, `clipboardWrite`, `scripting` (Chrome:
read the exact selection, keeping newlines; Firefox MV2 uses `tabs.executeScript`), host `https://qzz.tw/*`.

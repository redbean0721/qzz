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

```sh
yarn zip:ext   # → .output/qzz-extension-<version>-chrome.zip, -firefox.zip and -sources.zip
```

Bump `version` in `package.json` first.

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
  selected text the user submits are sent to qzz.tw.

Permissions: `activeTab` (current tab URL), `contextMenus`, `storage`, `clipboardWrite`, `scripting` (Chrome:
read the exact selection, keeping newlines; Firefox MV2 uses `tabs.executeScript`), host `https://qzz.tw/*`.

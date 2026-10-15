import { browser, type Browser } from 'wxt/browser'
import { MENU, MENUS, urlForMenu } from '../utils/menus'
import { pendingItem, type Pending } from '../utils/pending'

// Chrome MV3 是 action，Firefox MV2 是 browserAction
const action = browser.action ?? browser.browserAction

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(async () => {
    // 更新版本時也會跑：先清掉舊的項目，避免重複的 id 讓 create 失敗
    await browser.contextMenus.removeAll()
    for (const menu of MENUS) browser.contextMenus.create(menu)
  })

  browser.contextMenus.onClicked.addListener((info, tab) => {
    // 先同步開彈出視窗（Firefox 要求在使用者操作的當下呼叫），再把內容寫進 storage，彈出視窗會監聽到
    openPopup()
    void pendingFrom(info, tab).then((pending) => pending && pendingItem.setValue(pending))
  })
})

function openPopup() {
  try {
    void action
      .openPopup()
      .catch(openPopupWindow)
  } catch {
    openPopupWindow()
  }
}

// 不支援 openPopup 的瀏覽器：開一個小視窗顯示同一個頁面
function openPopupWindow() {
  void browser.windows.create({
    url: browser.runtime.getURL('/popup.html'),
    type: 'popup',
    width: 400,
    height: 640,
  })
}

async function pendingFrom(
  info: Browser.contextMenus.OnClickData,
  tab: Browser.tabs.Tab | undefined,
): Promise<Pending | null> {
  const at = Date.now()
  if (info.menuItemId === MENU.createPaste) {
    // selectionText 會把換行變成空白，盡量從頁面讀原始的選取文字
    const content = (tab?.id !== undefined && (await readSelection(tab.id))) || info.selectionText
    return content ? { kind: 'paste', content, at } : null
  }
  const url = urlForMenu(info)
  return url ? { kind: 'link', url, at } : null
}

async function readSelection(tabId: number): Promise<string | null> {
  try {
    if (browser.scripting) {
      const [result] = await browser.scripting.executeScript({
        target: { tabId },
        func: () => window.getSelection()?.toString() ?? '',
      })
      return (result?.result as string | undefined) || null
    }
    // Firefox MV2
    const [text] = (await browser.tabs.executeScript(tabId, { code: 'window.getSelection().toString()' })) as string[]
    return text || null
  } catch {
    // 例如 chrome:// 或擴充功能商店的頁面不能注入腳本
    return null
  }
}

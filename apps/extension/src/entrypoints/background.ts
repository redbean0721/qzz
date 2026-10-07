import { browser, type Browser } from 'wxt/browser'
import { pendingItem, type Pending } from '../utils/storage'

const MENU = {
  shortenLink: 'qzz-shorten-link',
  shortenPage: 'qzz-shorten-page',
  createPaste: 'qzz-create-paste',
} as const

// Chrome MV3 是 action，Firefox MV2 是 browserAction
const action = browser.action ?? browser.browserAction

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({ id: MENU.shortenLink, title: '用 qzz 縮短這個連結', contexts: ['link'] })
    browser.contextMenus.create({ id: MENU.shortenPage, title: '用 qzz 縮短這個網頁', contexts: ['page'] })
    browser.contextMenus.create({ id: MENU.createPaste, title: '用 qzz 把選取的文字建立成貼文', contexts: ['selection'] })
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
  switch (info.menuItemId) {
    case MENU.shortenLink:
      return info.linkUrl ? { kind: 'link', url: info.linkUrl, at } : null
    case MENU.shortenPage:
      return info.pageUrl ? { kind: 'link', url: info.pageUrl, at } : null
    case MENU.createPaste: {
      // selectionText 會把換行變成空白，盡量從頁面讀原始的選取文字
      const content = (tab?.id !== undefined && (await readSelection(tab.id))) || info.selectionText
      return content ? { kind: 'paste', content, at } : null
    }
    default:
      return null
  }
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

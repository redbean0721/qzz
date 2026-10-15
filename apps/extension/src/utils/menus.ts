// 右鍵選單的項目和「按了之後要縮短哪個網址」：純邏輯，背景程式（entrypoints/background.ts）負責註冊和讀取選取文字

export const MENU = {
  shortenLink: 'qzz-shorten-link',
  shortenImage: 'qzz-shorten-image',
  shortenVideo: 'qzz-shorten-video',
  shortenAudio: 'qzz-shorten-audio',
  shortenPage: 'qzz-shorten-page',
  createPaste: 'qzz-create-paste',
} as const

export type MenuId = (typeof MENU)[keyof typeof MENU]

// 只有 http / https 的網址才顯示：mailto:、javascript: 連結，data:、blob: 的圖片或串流影片都不能縮短
const HTTP_ONLY = ['http://*/*', 'https://*/*']

type Context = 'link' | 'image' | 'video' | 'audio' | 'page' | 'selection'

export type MenuDefinition = {
  id: MenuId
  title: string
  // contextMenus.create 的型別要求至少一個
  contexts: [Context, ...Context[]]
  targetUrlPatterns?: string[]
}

export const MENUS: MenuDefinition[] = [
  { id: MENU.shortenLink, title: '用 qzz 縮短這個連結', contexts: ['link'], targetUrlPatterns: HTTP_ONLY },
  { id: MENU.shortenImage, title: '用 qzz 縮短這張圖片的網址', contexts: ['image'], targetUrlPatterns: HTTP_ONLY },
  { id: MENU.shortenVideo, title: '用 qzz 縮短這個影片的網址', contexts: ['video'], targetUrlPatterns: HTTP_ONLY },
  { id: MENU.shortenAudio, title: '用 qzz 縮短這個音訊的網址', contexts: ['audio'], targetUrlPatterns: HTTP_ONLY },
  { id: MENU.shortenPage, title: '用 qzz 縮短這個網頁', contexts: ['page'] },
  { id: MENU.createPaste, title: '用 qzz 把選取的文字建立成貼文', contexts: ['selection'] },
]

export type MenuClick = { menuItemId: string | number; linkUrl?: string; srcUrl?: string; pageUrl?: string }

/** 縮短網址的選單項目對應的網址；不是縮短網址的項目（建立貼文）或缺少網址時回傳 null */
export function urlForMenu(info: MenuClick): string | null {
  switch (info.menuItemId) {
    case MENU.shortenLink:
      return info.linkUrl ?? null
    case MENU.shortenImage:
    case MENU.shortenVideo:
    case MENU.shortenAudio:
      return info.srcUrl ?? null
    case MENU.shortenPage:
      return info.pageUrl ?? null
    default:
      return null
  }
}

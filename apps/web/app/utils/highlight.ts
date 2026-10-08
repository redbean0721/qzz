import type { HighlighterCore } from 'shiki/core'

// 只在瀏覽器端、貼文頁需要時才載入：Shiki 和語法定義不會進首頁，也不會增加 Worker 的大小和 CPU 時間。
// key 對應 @qzz/shared 的 PASTE_LANGUAGES（text 不需要高亮）；每個語言是獨立的動態 import，只下載用到的那一個
const LANGUAGES: Record<string, () => Promise<{ default: unknown }>> = {
  bash: () => import('@shikijs/langs/bash'),
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  css: () => import('@shikijs/langs/css'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
  rust: () => import('@shikijs/langs/rust'),
  sql: () => import('@shikijs/langs/sql'),
  typescript: () => import('@shikijs/langs/typescript'),
  yaml: () => import('@shikijs/langs/yaml'),
}

// 太大的貼文不高亮，避免拖慢瀏覽器；照樣顯示純文字
export const MAX_HIGHLIGHT_BYTES = 100 * 1024

export function canHighlight(language: string | null, content: string): language is string {
  return language !== null && language in LANGUAGES && isSmallEnough(content)
}

export function isSmallEnough(content: string) {
  return new TextEncoder().encode(content).length <= MAX_HIGHLIGHT_BYTES
}

// Markdown 程式碼區塊常用的簡寫（```js、```py…）
const ALIASES: Record<string, string> = {
  'c++': 'cpp',
  golang: 'go',
  js: 'javascript',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'bash',
}

// 支援的語言回傳 LANGUAGES 的 key，其他回傳 null
export function resolveLanguage(name: string): string | null {
  const lower = name.toLowerCase()
  const resolved = ALIASES[lower] ?? lower
  return resolved in LANGUAGES ? resolved : null
}

let highlighter: Promise<HighlighterCore> | undefined

function getHighlighter() {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      // JavaScript 正規表示式引擎：不需要 WebAssembly，檔案比 Oniguruma 小
      import('shiki/engine/javascript'),
    ])
    return createHighlighterCore({
      themes: [import('@shikijs/themes/github-light'), import('@shikijs/themes/github-dark')],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
  })()
  return highlighter
}

async function loadLanguages(languages: string[]) {
  const hl = await getHighlighter()
  const loaded = hl.getLoadedLanguages()
  await Promise.all(
    languages
      .filter((language) => !loaded.includes(language))
      .map(async (language) => {
        const load = LANGUAGES[language]
        if (!load) throw new Error(`unsupported language: ${language}`)
        await hl.loadLanguage((await load()).default as Parameters<HighlighterCore['loadLanguage']>[0])
      }),
  )
  return hl
}

// 回傳放進 <code> 的 HTML（structure: 'inline'，換行是 <br>）。Shiki 會跳脫內容裡的 HTML；
// 顏色以 --shiki-light / --shiki-dark 變數輸出，由 main.css 依深淺色模式套用
function toHtml(hl: HighlighterCore, code: string, language: string) {
  return hl.codeToHtml(code, {
    lang: language,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
    structure: 'inline',
  })
}

export async function highlight(code: string, language: string): Promise<string> {
  return toHtml(await loadLanguages([language]), code, language)
}

// 先載入需要的語言，回傳同步的上色函式（markdown-it 的 highlight 選項必須是同步的）
export async function createCodeHighlighter(languages: string[]): Promise<(code: string, language: string) => string> {
  const hl = await loadLanguages(languages)
  return (code, language) => toHtml(hl, code, language)
}

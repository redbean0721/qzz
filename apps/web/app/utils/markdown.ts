import type { MarkdownIt, Token } from 'markdown-it'

// Markdown 貼文的預覽，跟語法高亮一樣只在瀏覽器端、需要時才載入（不進 Worker）。
// 貼文是任何人都能建立的內容，所以：
// - html: false（預設）：貼文裡的 HTML 原樣跳脫顯示，不會變成標籤
// - 連結只接受 http / https / mailto 和相對路徑，一律開新分頁並加 nofollow
// - 圖片不載入（會把看貼文的人的 IP 送到第三方伺服器），改成指向圖片的連結
// - 數學公式由 KaTeX 排版（setUpMath）
const LINK_REL = 'nofollow noopener noreferrer ugc'
const ALLOWED_LINK = /^(https?:|mailto:)/i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

export async function renderMarkdown(content: string): Promise<string> {
  const { default: MarkdownIt } = await import('markdown-it')
  const md = new MarkdownIt({ linkify: true })
  md.validateLink = (url) => !HAS_SCHEME.test(url) || ALLOWED_LINK.test(url)

  md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
    tokens[idx]!.attrSet('target', '_blank')
    tokens[idx]!.attrSet('rel', LINK_REL)
    return self.renderToken(tokens, idx, options)
  }

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!
    const src = String(token.attrGet('src') ?? '')
    const alt = self.renderInlineAsText(token.children ?? [], options, env)
    const label = md.utils.escapeHtml(`[圖片：${alt || src}]`)
    // 已經在連結裡（[![alt](img)](href)）就不再包一層 <a>
    if (insideLink(tokens, idx) || !/^https?:/i.test(src)) return label
    return `<a href="${md.utils.escapeHtml(src)}" target="_blank" rel="${LINK_REL}">${label}</a>`
  }

  await setUpMath(md, content)

  const env = {}
  const tokens = md.parse(content, env)
  await setUpCodeHighlighting(md, tokens, content)
  return md.renderer.render(tokens, md.options, env)
}

// 數學公式（$...$、$$...$$、```math）用 KaTeX 排版。KaTeX 和它的 CSS / 字型很大，內容看起來有公式才載入。
// KaTeX 預設 trust: false（擋掉 \href、\includegraphics 這類指令）、maxExpand 1000；公式寫錯只顯示紅字，不會讓整頁失敗。
// \(...\) 不啟用：在 Markdown 裡 \( 本來就是跳脫的括號
const MATH_HINT = /\$|^\s*(`{3,}|~{3,})\s*math\b/m

async function setUpMath(md: MarkdownIt, content: string) {
  if (!MATH_HINT.test(content)) return
  const [{ katex }] = await Promise.all([import('@mdit/plugin-katex'), import('katex/dist/katex.min.css')])
  md.use(katex, {
    delimiters: 'dollars',
    mathFence: true,
    // 單位 em：避免 \rule{1000em}{1000em} 這類撐爆版面的內容
    maxSize: 5,
    // 不認得的符號、數學模式裡的中文等只是警告，不要洗版 console
    logger: () => 'ignore' as const,
  })
}

function insideLink(tokens: Token[], idx: number) {
  let depth = 0
  for (let i = 0; i < idx; i++) {
    if (tokens[i]!.type === 'link_open') depth++
    else if (tokens[i]!.type === 'link_close') depth--
  }
  return depth > 0
}

// 程式碼區塊（```js）用 Shiki 上色：先找出用到的語言、載入後再 render（markdown-it 的 highlight 是同步的）。
// 太大的貼文或不支援的語言就照一般程式碼區塊顯示
async function setUpCodeHighlighting(md: MarkdownIt, tokens: Token[], content: string) {
  if (!isSmallEnough(content)) return
  const languages = new Set<string>()
  for (const token of tokens) {
    if (token.type !== 'fence') continue
    const language = resolveLanguage(token.info.trim().split(/\s+/)[0] ?? '')
    if (language) languages.add(language)
  }
  if (languages.size === 0) return

  try {
    const highlightCode = await createCodeHighlighter([...languages])
    md.set({
      highlight: (code, lang) => {
        const language = resolveLanguage(lang)
        // markdown-it 給的程式碼結尾有換行，Shiki 會多畫一行空白
        return language ? `<pre><code class="shiki-code">${highlightCode(code.replace(/\n$/, ''), language)}</code></pre>` : ''
      },
    })
  } catch (err) {
    console.warn('syntax highlighting failed', err)
  }
}

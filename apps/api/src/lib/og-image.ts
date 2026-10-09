import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import satori from 'satori'
import { INVISIBLE, markdownBlocks, type Block, type Inline } from './paste-summary.js'

// 貼文的預覽圖（og:image）：Discord、Threads 等貼上 qzz.tw/p/<code> 時顯示的圖。
// satori 把排版轉成 SVG（文字已轉成路徑），resvg 的 WebAssembly 版本再轉成 PNG
// （image 不能有原生模組，見 Dockerfile）。Markdown 排成文件的樣子，其他語言畫成程式碼

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

// 程式碼版面：24px 等寬字、行高 36px，放得下 10 行、約 68 個半形字
export const MAX_LINES = 10
export const MAX_COLUMNS = 68
const TAB = '    '

const PADDING = 56
const PANEL_PADDING_X = 36
const PANEL_PADDING_Y = 28
// 內容區（扣掉外框、標題列和內距）的大小，Markdown 用來估計放得下多少
const CONTENT_WIDTH = OG_WIDTH - PADDING * 2 - PANEL_PADDING_X * 2 - 2
const CONTENT_HEIGHT = OG_HEIGHT - PADDING * 2 - 72 - PANEL_PADDING_Y * 2 - 2

const require = createRequire(import.meta.url)

type Weight = 400 | 700
type Font = { name: string; data: Buffer; weight: Weight; style: 'normal' }

// fontsource 把字型依 unicode 範圍拆成很多檔；只用 woff（satori 不支援 woff2）。
// 同一個名稱的字型 satori 只會用第一個檔案，所以每個範圍各自取名（去掉字重的檔名），再全部列進 fontFamily，
// 缺字時依序往後找；拉丁字母的檔案排前面。同名不同字重的檔案讓 satori 依 fontWeight 挑
function loadFonts(pkg: string, weights: Weight[]): Font[] {
  const dir = join(dirname(require.resolve(`${pkg}/LICENSE`)), 'files')
  const latinFirst = (a: string, b: string) => Number(!a.includes('-latin-')) - Number(!b.includes('-latin-')) || a.localeCompare(b)
  return weights.flatMap((weight) =>
    readdirSync(dir)
      .filter((file) => file.endsWith(`-${weight}-normal.woff`))
      .sort(latinFirst)
      .map((file) => ({
        name: file.replace(/-\d00-normal\.woff$/, ''),
        data: readFileSync(join(dir, file)),
        weight,
        style: 'normal' as const,
      })),
  )
}

const families = (...groups: Font[][]) => [...new Set(groups.flat().map((font) => font.name))].join(', ')

// 第一次用到才載入；satori 依 fonts 陣列快取解析過的字型，所以一直用同一個陣列
let ready: Promise<{ fonts: Font[]; mono: string; prose: string }> | undefined
function setUp() {
  ready ??= (async () => {
    await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')))
    const mono = loadFonts('@fontsource/noto-sans-mono', [400])
    // Markdown 的標題和粗體要 700
    const tc = loadFonts('@fontsource/noto-sans-tc', [400, 700])
    // 單色的 emoji，跟文字同色
    const emoji = loadFonts('@fontsource/noto-emoji', [400])
    return { fonts: [...mono, ...tc, ...emoji], mono: families(mono, tc, emoji), prose: families(tc, emoji, mono) }
  })()
  return ready
}

// 全形字（中日韓文字、全形符號）和 emoji 佔兩格
const WIDE = /\p{Extended_Pictographic}|[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦\u{20000}-\u{3fffd}]/u

// 截到 columns 格（全形字算兩格），有截掉時結尾放 …
function cutLine(line: string, columns: number): { text: string; cut: boolean } {
  let width = 0
  let text = ''
  for (const char of line) {
    width += WIDE.test(char) ? 2 : 1
    if (width > columns - 1) return { text: text + '…', cut: true }
    text += char
  }
  return { text, cut: false }
}

export type PreviewLines = { lines: string[]; truncated: boolean }

// 取開頭幾行，每行截到 columns 格；有截掉內容時 truncated = true
export function previewLines(content: string, maxLines = MAX_LINES, columns = MAX_COLUMNS): PreviewLines {
  const all = content.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  let truncated = all.length > maxLines

  const lines = all.slice(0, maxLines).map((raw) => {
    const { text, cut } = cutLine(raw.replace(/\t/g, TAB).replace(INVISIBLE, '').trimEnd(), columns)
    if (cut) truncated = true
    return text
  })

  return { lines, truncated }
}

export type PasteImageInput = {
  code: string
  host: string
  content: string
  language: string | null
}

// satori 吃 React element 形狀的物件，這裡不用 JSX
type Node = { type: string; props: { style?: Record<string, unknown>; children?: unknown } }
const h = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({ type, props: { style, children } })

const COLORS = {
  background: '#09090b',
  panel: '#18181b',
  border: '#27272a',
  heading: '#fafafa',
  text: '#e4e4e7',
  quote: '#a1a1aa',
  muted: '#71717a',
  primary: '#00c16a',
}

// 一次只畫一張：每張要約 100 ms CPU 和數 MB 的 WebAssembly 記憶體，同時畫很多張只會一起變慢、記憶體暴增
let queue: Promise<unknown> = Promise.resolve()

export function renderPasteImage(input: PasteImageInput): Promise<Buffer> {
  const result = queue.then(() => render(input))
  queue = result.catch(() => {})
  return result
}

async function render({ code, host, content, language }: PasteImageInput): Promise<Buffer> {
  const { fonts, mono, prose } = await setUp()
  const lineCount = content.replace(/\n+$/, '').split('\n').length
  const meta = [language && language !== 'text' ? language : null, `${lineCount} 行`].filter(Boolean).join(' · ')

  const blocks = language === 'markdown' ? markdownBlocks(content) : []
  const body = blocks.length > 0 ? markdownBody(blocks, mono) : codeBody(content)

  const tree = h(
    'div',
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: 'flex',
      flexDirection: 'column',
      padding: PADDING,
      background: COLORS.background,
      color: COLORS.text,
      fontFamily: blocks.length > 0 ? prose : mono,
    },
    [
      h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, marginBottom: 28, fontFamily: mono }, [
        h('div', { display: 'flex', fontSize: 32 }, [
          h('span', { color: COLORS.primary }, host),
          h('span', { color: COLORS.muted }, `/p/${code}`),
        ]),
        h('span', { fontSize: 26, color: COLORS.muted }, meta),
      ]),
      h(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          // 固定高度：內容太多時裁掉，不要把外框撐大
          height: OG_HEIGHT - PADDING * 2 - 72,
          flexShrink: 0,
          position: 'relative',
          overflow: 'hidden',
          padding: `${PANEL_PADDING_Y}px ${PANEL_PADDING_X}px`,
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
        },
        [
          ...body.children,
          // 還有更多內容：底部淡出
          ...(body.truncated
            ? [
                h('div', {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: 120,
                  backgroundImage: `linear-gradient(to bottom, rgba(24, 24, 27, 0), ${COLORS.panel})`,
                }),
              ]
            : []),
        ],
      ),
    ],
  )

  const svg = await satori(tree as Parameters<typeof satori>[0], { width: OG_WIDTH, height: OG_HEIGHT, fonts })
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng())
}

type Body = { children: Node[]; truncated: boolean }

// 一般貼文：等寬字加行號
function codeBody(content: string): Body {
  const { lines, truncated } = previewLines(content)
  const children = lines.map((line, i) =>
    h('div', { display: 'flex', height: 36, fontSize: 24, lineHeight: '36px' }, [
      h('span', { width: 56, flexShrink: 0, color: COLORS.muted }, String(i + 1)),
      // 空白行也要佔高度；whiteSpace: pre 保留縮排
      h('span', { whiteSpace: 'pre' }, line || ' '),
    ]),
  )
  return { children, truncated }
}

// ---- Markdown ----

const TEXT_SIZE = 24
const TEXT_LINE = 36
const HEADING_SIZE: Record<number, number> = { 1: 38, 2: 32 }
const CODE_SIZE = 20
const CODE_LINE = 30
const CODE_MAX_LINES = 6
const BLOCK_GAP = 14
// 清單項目之間
const ITEM_GAP = 4
const INDENT = 32
const MARKER_WIDTH = 34
const QUOTE_INSET = 20
// 每個區塊最多畫這麼多字（太長的段落反正會被裁掉，少畫一點比較快）
const BLOCK_CHARS = 400
const INLINE_CODE_COLUMNS = 40

// satori 沒有行內排版：把文字拆成一個個詞（中日韓文字一字一個），當成會換行的 flex 項目排。
// 句讀和右括號黏在前一個字後面，換行時才不會出現在行首
const TOKEN = /(?:\p{Extended_Pictographic}|[⺀-鿿가-힣豈-﫿＀-￯])[、。」』】〕！），：；？…]*|[^\s⺀-鿿가-힣豈-﫿＀-￯\p{Extended_Pictographic}]+\s*|\s+/gu

// 估計文字寬度（px）：全形字一個字寬，其他約半個字寬
function textWidth(text: string, size: number) {
  let width = 0
  for (const char of text) width += WIDE.test(char) ? size : size * 0.55
  return width
}

// 依序取出最多 BLOCK_CHARS 個字的行內內容
function limitInlines(inlines: Inline[]): { inlines: Inline[]; cut: boolean } {
  let left = BLOCK_CHARS
  const out: Inline[] = []
  for (const inline of inlines) {
    const chars = [...inline.text]
    if (chars.length > left) {
      out.push({ ...inline, text: chars.slice(0, left).join('') + '…' })
      return { inlines: out, cut: true }
    }
    out.push(inline)
    left -= chars.length
  }
  return { inlines: out, cut: false }
}

function inlineNodes(inlines: Inline[], size: number, mono: string): Node[] {
  return inlines.flatMap((inline) => {
    if (inline.code) {
      const { text } = cutLine(inline.text, INLINE_CODE_COLUMNS)
      return [
        h(
          'span',
          {
            whiteSpace: 'pre',
            fontFamily: mono,
            fontSize: size * 0.88,
            background: COLORS.border,
            borderRadius: 6,
            padding: '0 6px',
            margin: '0 2px',
          },
          text,
        ),
      ]
    }
    const style: Record<string, unknown> = { whiteSpace: 'pre' }
    if (inline.bold) style.fontWeight = 700
    if (inline.link) style.color = COLORS.primary
    if (inline.strike) style.textDecoration = 'line-through'
    return (inline.text.match(TOKEN) ?? []).map((token) => h('span', style, token))
  })
}

function blockHeight(block: Block, width: number): number {
  switch (block.type) {
    case 'rule':
      return 1 + BLOCK_GAP * 2
    case 'code':
      return Math.min(block.text.split('\n').length, CODE_MAX_LINES) * CODE_LINE + 24 + BLOCK_GAP
    case 'heading': {
      const size = HEADING_SIZE[block.level] ?? 28
      const text = block.inlines.map((inline) => inline.text).join('')
      return Math.max(1, Math.ceil(textWidth(text, size) / width)) * Math.round(size * 1.35) + BLOCK_GAP
    }
    case 'text': {
      const text = block.inlines.map((inline) => inline.text).join('')
      return Math.max(1, Math.ceil(textWidth(text, TEXT_SIZE) / width)) * TEXT_LINE + gapAfter(block)
    }
  }
}

const gapAfter = (block: Block) => (block.type === 'text' && block.indent > 0 ? ITEM_GAP : BLOCK_GAP)

function blockNode(block: Block, mono: string): { node: Node; cut: boolean } {
  if (block.type === 'rule') {
    return { node: h('div', { height: 1, flexShrink: 0, background: COLORS.border, margin: `${BLOCK_GAP}px 0` }), cut: false }
  }

  const indent = 'indent' in block ? block.indent : 0
  const quote = 'quote' in block && block.quote
  const outer: Record<string, unknown> = { display: 'flex', flexShrink: 0, marginBottom: gapAfter(block), marginLeft: indent * INDENT }
  if (quote) Object.assign(outer, { borderLeft: `4px solid ${COLORS.border}`, paddingLeft: QUOTE_INSET - 4, color: COLORS.quote })

  if (block.type === 'code') {
    const { lines, truncated } = previewLines(block.text, CODE_MAX_LINES, Math.floor(CONTENT_WIDTH / (CODE_SIZE * 0.6)) - indent * 3)
    const code = h(
      'div',
      {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        padding: '12px 16px',
        fontFamily: mono,
        fontSize: CODE_SIZE,
        lineHeight: `${CODE_LINE}px`,
        background: COLORS.background,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
      },
      lines.map((line) => h('span', { whiteSpace: 'pre', height: CODE_LINE }, line || ' ')),
    )
    return { node: h('div', outer, [code]), cut: truncated }
  }

  const { inlines, cut } = limitInlines(block.inlines)
  if (block.type === 'heading') {
    const size = HEADING_SIZE[block.level] ?? 28
    const text = h(
      'div',
      { display: 'flex', flexWrap: 'wrap', fontSize: size, lineHeight: 1.35, fontWeight: 700, color: COLORS.heading },
      inlineNodes(inlines, size, mono),
    )
    return { node: h('div', outer, [text]), cut }
  }

  const text = h(
    'div',
    { display: 'flex', flexWrap: 'wrap', flexGrow: 1, flexShrink: 1, fontSize: TEXT_SIZE, lineHeight: `${TEXT_LINE}px`, fontWeight: block.bold ? 700 : 400 },
    inlineNodes(inlines, TEXT_SIZE, mono),
  )
  const marker = block.marker
    ? [h('span', { width: MARKER_WIDTH, flexShrink: 0, fontSize: TEXT_SIZE, lineHeight: `${TEXT_LINE}px`, color: COLORS.muted }, block.marker)]
    : []
  return { node: h('div', outer, [...marker, text]), cut }
}

// 依估計的高度放區塊，放不下的就停；超出的部分由外框裁掉、底部淡出
function markdownBody(blocks: Block[], mono: string): Body {
  const children: Node[] = []
  let used = 0
  let truncated = false

  for (const [i, block] of blocks.entries()) {
    const indent = 'indent' in block ? block.indent : 0
    const quote = 'quote' in block && block.quote
    const marker = block.type === 'text' && block.marker ? MARKER_WIDTH : 0
    const width = CONTENT_WIDTH - indent * INDENT - (quote ? QUOTE_INSET : 0) - marker
    const height = blockHeight(block, width)

    // 一行都放不下就不畫了
    if (used + Math.min(height, TEXT_LINE) > CONTENT_HEIGHT) {
      truncated = true
      break
    }
    const { node, cut } = blockNode(block, mono)
    children.push(node)
    used += height
    if (cut || used > CONTENT_HEIGHT) truncated = true
    if (used >= CONTENT_HEIGHT) {
      if (i < blocks.length - 1) truncated = true
      break
    }
  }
  return { children, truncated }
}

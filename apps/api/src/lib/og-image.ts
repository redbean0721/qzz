import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { Resvg, initWasm } from '@resvg/resvg-wasm'
import satori from 'satori'

// 貼文的預覽圖（og:image）：Discord、Threads 等貼上 qzz.tw/p/<code> 時顯示的圖。
// satori 把排版轉成 SVG（文字已轉成路徑），resvg 的 WebAssembly 版本再轉成 PNG
// （image 不能有原生模組，見 Dockerfile）

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630

// 跟下面的版面配合：24px 等寬字、行高 36px，程式碼區塊放得下 10 行、約 68 個半形字
export const MAX_LINES = 10
export const MAX_COLUMNS = 68
const TAB = '    '

const require = createRequire(import.meta.url)

type Font = { name: string; data: Buffer; weight: 400; style: 'normal' }

// fontsource 把字型依 unicode 範圍拆成很多檔；只用 400 的 woff（satori 不支援 woff2）。
// 同一個名稱的字型 satori 只會用第一個檔案，所以每個檔案各自取名（檔名），再全部列進 fontFamily：
// 等寬字（拉丁字母先）放前面，缺字時依序往後找
function loadFonts(pkg: string): Font[] {
  const dir = join(dirname(require.resolve(`${pkg}/LICENSE`)), 'files')
  return readdirSync(dir)
    .filter((file) => file.endsWith('-400-normal.woff'))
    .sort((a, b) => Number(!a.includes('-latin-')) - Number(!b.includes('-latin-')) || a.localeCompare(b))
    .map((file) => ({ name: file.replace(/\.woff$/, ''), data: readFileSync(join(dir, file)), weight: 400, style: 'normal' }))
}

// 第一次用到才載入；satori 依 fonts 陣列快取解析過的字型，所以一直用同一個陣列
let ready: Promise<{ fonts: Font[]; fontFamily: string }> | undefined
function setUp() {
  ready ??= (async () => {
    await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')))
    const fonts = [
      ...loadFonts('@fontsource/noto-sans-mono'),
      ...loadFonts('@fontsource/noto-sans-tc'),
      // 單色的 emoji，跟文字同色
      ...loadFonts('@fontsource/noto-emoji'),
    ]
    return { fonts, fontFamily: fonts.map((font) => font.name).join(', ') }
  })()
  return ready
}

// 全形字（中日韓文字、全形符號）佔兩格
const WIDE = /\p{Extended_Pictographic}|[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6\u{20000}-\u{3fffd}]/u
// 控制字元、零寬字元和文字方向控制字元都拿掉（方向控制字元會讓顯示的內容跟實際不同）
const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

export type PreviewLines = { lines: string[]; truncated: boolean }

// 取開頭幾行，每行截到 MAX_COLUMNS 格；有截掉內容時 truncated = true
export function previewLines(content: string): PreviewLines {
  const all = content.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  let truncated = all.length > MAX_LINES

  const lines = all.slice(0, MAX_LINES).map((raw) => {
    const line = raw.replace(/\t/g, TAB).replace(INVISIBLE, '').trimEnd()
    let width = 0
    let out = ''
    for (const char of line) {
      width += WIDE.test(char) ? 2 : 1
      if (width > MAX_COLUMNS - 1) {
        truncated = true
        return out + '…'
      }
      out += char
    }
    return out
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
  text: '#e4e4e7',
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
  const { fonts, fontFamily } = await setUp()
  const { lines, truncated } = previewLines(content)
  const lineCount = content.replace(/\n+$/, '').split('\n').length
  const meta = [language && language !== 'text' ? language : null, `${lineCount} 行`].filter(Boolean).join(' · ')

  const codeLines = lines.map((line, i) =>
    h('div', { display: 'flex', height: 36 }, [
      h('span', { width: 56, flexShrink: 0, color: COLORS.muted }, String(i + 1)),
      // 空白行也要佔高度；whiteSpace: pre 保留縮排
      h('span', { whiteSpace: 'pre' }, line || ' '),
    ]),
  )

  const tree = h(
    'div',
    {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      display: 'flex',
      flexDirection: 'column',
      padding: 56,
      background: COLORS.background,
      color: COLORS.text,
      fontFamily,
    },
    [
      h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 32, marginBottom: 28 }, [
        h('div', { display: 'flex' }, [
          h('span', { color: COLORS.primary, fontWeight: 400 }, host),
          h('span', { color: COLORS.muted }, `/p/${code}`),
        ]),
        h('span', { fontSize: 26, color: COLORS.muted }, meta),
      ]),
      h(
        'div',
        {
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          position: 'relative',
          overflow: 'hidden',
          padding: '28px 32px',
          fontSize: 24,
          lineHeight: '36px',
          background: COLORS.panel,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 16,
        },
        [
          ...codeLines,
          // 還有更多內容：底部淡出
          ...(truncated
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

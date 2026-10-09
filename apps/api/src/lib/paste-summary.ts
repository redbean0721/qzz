import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'

// 貼文的摘要：og:description 的純文字，以及預覽圖要畫的 Markdown 區塊。
// 只處理開頭一段（預覽只用得到開頭），截斷的 Markdown（例如沒結束的 ```）照樣能解析

const SOURCE_CHARS = 8000
export const DESCRIPTION_CHARS = 160

// 控制字元、零寬字元和文字方向控制字元：顯示時拿掉（方向控制字元會讓顯示的內容跟實際不同）
export const INVISIBLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤⁦-⁩﻿]/g

export type Inline = { text: string; bold?: boolean; code?: boolean; link?: boolean; strike?: boolean }

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  // 段落、清單項目、引言、表格的一列都是 text：marker 是清單符號，indent 是清單層數
  | { type: 'text'; inlines: Inline[]; marker?: string; indent: number; quote: boolean; bold?: boolean }
  | { type: 'code'; text: string; indent: number; quote: boolean }
  | { type: 'rule' }

const md = new MarkdownIt({ linkify: true })

function head(content: string) {
  if (content.length <= SOURCE_CHARS) return content
  const cut = content.slice(0, SOURCE_CHARS)
  // 盡量在換行處切，避免切在一個字的中間
  const newline = cut.lastIndexOf('\n')
  return newline > SOURCE_CHARS / 2 ? cut.slice(0, newline) : cut
}

function toInlines(children: Token[]): Inline[] {
  const out: Inline[] = []
  let bold = 0
  let strike = 0
  let link = 0
  const push = (text: string, extra: Partial<Inline> = {}) => {
    const inline: Inline = { text: text.replace(INVISIBLE, ''), bold: bold > 0, link: link > 0, strike: strike > 0, ...extra }
    const last = out.at(-1)
    // 樣式相同就接在一起，畫的時候少一點元素
    if (last && !inline.code && !last.code && last.bold === inline.bold && last.link === inline.link && last.strike === inline.strike) {
      last.text += inline.text
    } else if (inline.text) {
      out.push(inline)
    }
  }

  for (const child of children) {
    switch (child.type) {
      case 'text':
      case 'html_inline':
        push(child.content)
        break
      case 'code_inline':
        push(child.content, { code: true })
        break
      case 'softbreak':
      case 'hardbreak':
        push(' ')
        break
      case 'image':
        // 跟網站的預覽一樣不顯示圖片，只寫出替代文字
        push(`[圖片：${child.content || child.attrGet('src') || ''}]`)
        break
      case 'strong_open':
        bold++
        break
      case 'strong_close':
        bold--
        break
      case 's_open':
        strike++
        break
      case 's_close':
        strike--
        break
      case 'link_open':
        link++
        break
      case 'link_close':
        link--
        break
    }
  }
  return out
}

export function markdownBlocks(content: string): Block[] {
  const blocks: Block[] = []
  const lists: Array<{ ordered: boolean; next: number }> = []
  let quoteDepth = 0
  let headingLevel = 0
  let marker: string | undefined
  let row: Inline[][] | null = null
  let headerRow = false

  for (const token of md.parse(head(content), {})) {
    const quote = quoteDepth > 0
    switch (token.type) {
      case 'bullet_list_open':
        lists.push({ ordered: false, next: 0 })
        break
      case 'ordered_list_open':
        lists.push({ ordered: true, next: Number(token.attrGet('start') ?? 1) })
        break
      case 'bullet_list_close':
      case 'ordered_list_close':
        lists.pop()
        break
      case 'list_item_open': {
        const list = lists.at(-1)
        marker = list?.ordered ? `${list.next++}.` : '•'
        break
      }
      case 'blockquote_open':
        quoteDepth++
        break
      case 'blockquote_close':
        quoteDepth--
        break
      case 'heading_open':
        headingLevel = Number(token.tag.slice(1))
        break
      case 'heading_close':
        headingLevel = 0
        break
      case 'thead_open':
        headerRow = true
        break
      case 'thead_close':
        headerRow = false
        break
      case 'tr_open':
        row = []
        break
      case 'tr_close':
        if (row) {
          const inlines = row.flatMap((cell, i) => (i === 0 ? cell : [{ text: '   ' }, ...cell]))
          blocks.push({ type: 'text', inlines, indent: lists.length, quote, bold: headerRow })
        }
        row = null
        break
      case 'inline': {
        const inlines = toInlines(token.children ?? [])
        if (row) row.push(inlines)
        else if (headingLevel) blocks.push({ type: 'heading', level: headingLevel, inlines })
        else blocks.push({ type: 'text', inlines, marker, indent: lists.length, quote })
        marker = undefined
        break
      }
      case 'fence':
      case 'code_block':
        blocks.push({ type: 'code', text: token.content.replace(/\n$/, ''), indent: lists.length, quote })
        marker = undefined
        break
      case 'hr':
        blocks.push({ type: 'rule' })
        break
    }
  }
  return blocks
}

const inlineText = (inlines: Inline[]) => inlines.map((inline) => inline.text).join('')

// og:description：Markdown 拿掉格式符號，其他語言照原文；空白壓成一個，太長就截斷
export function pasteDescription(content: string, language: string | null): string {
  const text =
    language === 'markdown'
      ? markdownBlocks(content)
          .map((block) => {
            if (block.type === 'rule') return ''
            if (block.type === 'code') return block.text
            // 編號留著，項目符號 • 不用
            const marker = block.type === 'text' && block.marker && block.marker !== '•' ? `${block.marker} ` : ''
            return marker + inlineText(block.inlines)
          })
          .join(' ')
      : head(content)
  const flat = text.replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()
  return flat.length > DESCRIPTION_CHARS ? `${flat.slice(0, DESCRIPTION_CHARS)}…` : flat
}

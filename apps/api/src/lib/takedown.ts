import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { CODE_PATTERN } from './code.js'

export type Target = { kind: 'link' | 'paste'; code: string }

// 前面可以有 https://qzz.tw/（或任何網域）或 /，後面可以有結尾斜線。
// 網域後面一定要接斜線，否則 https://qzz.tw/ 會被拆成網域 qzz.t 加短碼 w
const PREFIX = String.raw`^(?:https?:\/\/[^/]+\/|\/)?`
const URL_FORMS: Array<[RegExp, Target['kind']]> = [
  [new RegExp(PREFIX + String.raw`(?:v1\/links\/)?([0-9A-Za-z]+)\/?$`), 'link'],
  [new RegExp(PREFIX + String.raw`(?:p|v1\/pastes)\/([0-9A-Za-z]+)(?:\/raw)?\/?$`), 'paste'],
]

// 接受 `link <code>`、`paste <code>`，或直接貼網址：
// https://qzz.tw/<code>、https://qzz.tw/p/<code>、https://qzz.tw/v1/pastes/<code>/raw
export function parseTarget(args: string[]): Target | null {
  let target: Target | null = null

  if (args.length === 2 && (args[0] === 'link' || args[0] === 'paste')) {
    target = { kind: args[0], code: args[1]! }
  } else if (args.length === 1 && args[0] !== 'link' && args[0] !== 'paste') {
    // 單獨的 link / paste 是漏了 code，不當成短碼
    for (const [pattern, kind] of URL_FORMS) {
      const match = pattern.exec(args[0]!.trim())
      if (match) {
        target = { kind, code: match[1]! }
        break
      }
    }
  }

  return target && CODE_PATTERN.test(target.code) ? target : null
}

const tableOf = (kind: Target['kind']) => (kind === 'link' ? schema.links : schema.pastes)

// 回傳是否找到這筆資料；下架後讀取立刻變成 404（GET 都有過濾 disabled）
export async function setDisabled(target: Target, disabled: boolean): Promise<boolean> {
  const table = tableOf(target.kind)
  const rows = await db
    .update(table)
    .set({ disabled })
    .where(eq(table.code, target.code))
    .returning({ code: table.code })
  return rows.length > 0
}

export async function describeTarget(target: Target) {
  if (target.kind === 'link') {
    const { links } = schema
    const [row] = await db
      .select({
        code: links.code,
        url: links.url,
        disabled: links.disabled,
        creatorIp: links.creatorIp,
        createdAt: links.createdAt,
        expiresAt: links.expiresAt,
      })
      .from(links)
      .where(eq(links.code, target.code))
    return row
  }

  const { pastes } = schema
  const [row] = await db
    .select({
      code: pastes.code,
      language: pastes.language,
      content: pastes.content,
      disabled: pastes.disabled,
      creatorIp: pastes.creatorIp,
      createdAt: pastes.createdAt,
      expiresAt: pastes.expiresAt,
    })
    .from(pastes)
    .where(eq(pastes.code, target.code))
  if (!row) return undefined

  // 只顯示開頭，避免把整篇（最多 512 KB）印到終端機
  const { content, ...rest } = row
  return { ...rest, bytes: Buffer.byteLength(content), preview: content.slice(0, 300) }
}

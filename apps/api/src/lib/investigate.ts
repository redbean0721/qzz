import { isIP } from 'node:net'
import { and, desc, eq, gt, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

// 調查濫用用的查詢（admin recent / ips / by-ip / disable-ip）：最近建立的內容、依建立者 IP 找、一次下架。
// 換位址很容易（IPv6 的 /48 一年只要幾塊美金），所以 ips 以網段分組（IPv4 /24、IPv6 /48），by-ip / disable-ip 也接受網段

const { links, pastes, reports } = schema

export type Kind = 'link' | 'paste'

export type ContentRow = {
  kind: Kind
  code: string
  /** 短網址的目的地，或貼文開頭的 80 個字 */
  summary: string
  language: string | null
  /** 貼文的大小（UTF-8 bytes）；短網址是 null */
  bytes: number | null
  disabled: boolean
  expired: boolean
  /** 定期重新檢查時被 Safe Browsing 標記的威脅類型（短網址才有） */
  threats: string[] | null
  creatorIp: string | null
  createdAt: Date
}

// 太大的網段一不小心就會下架一大堆不相干的內容
const MIN_PREFIX = { 4: 16, 6: 32 } as const

/**
 * 1.2.3.4、2001:db8::1、1.2.3.0/24、2001:db8:1:2::/64 → 給 Postgres `inet <<=` 用的字串；格式不對或網段太大回傳 null
 */
export function parseIpFilter(input: string): string | null {
  const [address = '', prefix, ...extra] = input.trim().split('/')
  const family = isIP(address)
  if ((family !== 4 && family !== 6) || extra.length > 0) return null
  if (prefix === undefined) return address
  if (!/^\d{1,3}$/.test(prefix)) return null
  const bits = Number(prefix)
  if (bits < MIN_PREFIX[family] || bits > (family === 4 ? 32 : 128)) return null
  return `${address}/${bits}`
}

/** 30m、24h、7d → 毫秒 */
export function parseDuration(input: string): number | null {
  const match = /^(\d{1,4})([mhd])$/.exec(input)
  if (!match) return null
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd']
  const ms = Number(match[1]) * unit
  return ms > 0 ? ms : null
}

const since = (ms: number) => sql`now() - make_interval(secs => ${ms / 1000})`

async function selectContent(kind: Kind, where: SQL | undefined, limit: number): Promise<ContentRow[]> {
  const table = kind === 'link' ? links : pastes
  const rows = await db
    .select({
      code: table.code,
      summary: kind === 'link' ? links.url : sql<string>`left(${pastes.content}, 80)`,
      language: kind === 'link' ? sql<null>`null` : pastes.language,
      bytes: kind === 'link' ? sql<null>`null` : sql<number>`octet_length(${pastes.content})`,
      disabled: table.disabled,
      expired: sql<boolean>`coalesce(${table.expiresAt} <= now(), false)`,
      threats: kind === 'link' ? links.safeBrowsingThreats : sql<null>`null`,
      creatorIp: table.creatorIp,
      createdAt: table.createdAt,
    })
    .from(table)
    .where(where)
    .orderBy(desc(table.createdAt), desc(table.id))
    .limit(limit)
  return rows.map((row) => ({ kind, ...row }))
}

const kindsOf = (kind?: Kind): Kind[] => (kind ? [kind] : ['link', 'paste'])

async function listContent(kind: Kind | undefined, where: (kind: Kind) => SQL | undefined, limit: number) {
  const rows = (await Promise.all(kindsOf(kind).map((k) => selectContent(k, where(k), limit)))).flat()
  return rows.sort((a, b) => Number(b.createdAt) - Number(a.createdAt)).slice(0, limit)
}

const tableOf = (kind: Kind) => (kind === 'link' ? links : pastes)

/** 最近建立的內容，新的在前面 */
export function listRecent({ kind, limit = 50, sinceMs }: { kind?: Kind; limit?: number; sinceMs?: number } = {}) {
  return listContent(kind, (k) => (sinceMs ? gt(tableOf(k).createdAt, since(sinceMs)) : undefined), limit)
}

const fromIp = (kind: Kind, filter: string) => sql`${tableOf(kind).creatorIp} <<= ${filter}::inet`

/** 某個 IP（或網段）建立的內容，新的在前面 */
export function listByIp(filter: string, { kind, limit = 1000 }: { kind?: Kind; limit?: number } = {}) {
  return listContent(kind, (k) => fromIp(k, filter), limit)
}

export type IpSummary = {
  /** 網段（CIDR，可以直接拿去 by-ip / disable-ip） */
  network: string
  /** 網段裡有幾個不同的位址：1 = 很可能是同一個人，多個 = 可能是同一家 ISP 的不同使用者 */
  addresses: number
  links: number
  pastes: number
  disabled: number
  firstAt: Date
  lastAt: Date
}

/** 分組的網段大小。IPv6 的 /48 一年只要幾塊美金，濫用者很容易換位址，所以預設以 /48 為一組；IPv4 預設 /24 */
export const GROUP_PREFIX = { 4: 24, 6: 48 } as const

/** ips 可以用的網段大小：不比 parseIpFilter 允許的大，最小到單一位址 */
export function isGroupPrefix(family: 4 | 6, prefix: number): boolean {
  return Number.isInteger(prefix) && prefix >= MIN_PREFIX[family] && prefix <= (family === 4 ? 32 : 128)
}

/** 一段時間內建立最多內容的網段（IPv4 預設 /24、IPv6 預設 /48），多的在前面 */
export async function topIps({
  sinceMs,
  limit = 20,
  v4 = GROUP_PREFIX[4],
  v6 = GROUP_PREFIX[6],
}: {
  sinceMs: number
  limit?: number
  v4?: number
  v6?: number
}): Promise<IpSummary[]> {
  if (!isGroupPrefix(4, v4) || !isGroupPrefix(6, v6)) throw new RangeError(`bad prefix /${v4} /${v6}`)
  const result = await db.execute<{
    network: string
    addresses: number
    links: number
    pastes: number
    disabled: number
    first_at: string
    last_at: string
  }>(sql`
    select
      network(set_masklen(creator_ip, case when family(creator_ip) = 6 then ${v6}::int else ${v4}::int end))::text
        as network,
      count(distinct creator_ip)::int as addresses,
      (count(*) filter (where kind = 'link'))::int as links,
      (count(*) filter (where kind = 'paste'))::int as pastes,
      (count(*) filter (where disabled))::int as disabled,
      min(created_at) as first_at,
      max(created_at) as last_at
    from (
      select 'link' as kind, ${links.creatorIp} as creator_ip, ${links.disabled} as disabled, ${links.createdAt} as created_at
        from ${links} where ${links.createdAt} > ${since(sinceMs)}
      union all
      select 'paste', ${pastes.creatorIp}, ${pastes.disabled}, ${pastes.createdAt}
        from ${pastes} where ${pastes.createdAt} > ${since(sinceMs)}
    ) recent
    where creator_ip is not null
    group by 1
    order by count(*) desc, max(created_at) desc
    limit ${limit}
  `)
  return result.rows.map(({ first_at, last_at, ...row }) => ({
    ...row,
    firstAt: new Date(first_at),
    lastAt: new Date(last_at),
  }))
}

export type BulkTakedown = { links: string[]; pastes: string[]; reportsResolved: number }

/** 下架某個 IP（或網段）建立、還沒下架的全部內容，並把它們未處理的檢舉標成已處理 */
export async function disableByIp(filter: string): Promise<BulkTakedown> {
  return db.transaction(async (tx) => {
    const disable = (kind: Kind) => {
      const table = tableOf(kind)
      return tx
        .update(table)
        .set({ disabled: true })
        .where(and(eq(table.disabled, false), fromIp(kind, filter)))
        .returning({ id: table.id, code: table.code })
    }
    const linkRows = await disable('link')
    const pasteRows = await disable('paste')
    const linkIds = linkRows.map((row) => row.id)
    const pasteIds = pasteRows.map((row) => row.id)
    let reportsResolved = 0
    if (linkIds.length + pasteIds.length > 0) {
      const resolved = await tx
        .update(reports)
        .set({ resolvedAt: sql`now()` })
        .where(
          and(
            isNull(reports.resolvedAt),
            or(
              linkIds.length > 0 ? inArray(reports.linkId, linkIds) : undefined,
              pasteIds.length > 0 ? inArray(reports.pasteId, pasteIds) : undefined,
            ),
          ),
        )
        .returning({ id: reports.id })
      reportsResolved = resolved.length
    }
    return { links: linkRows.map((row) => row.code), pastes: pasteRows.map((row) => row.code), reportsResolved }
  })
}

// ---- 輸出 -------------------------------------------------------------------

/**
 * 印到終端機前處理使用者的內容：換行和 tab 變空白，其他控制字元和格式字元（ANSI 跳脫序列的 ESC、雙向文字控制
 * 等）顯示成 \u{…}，免得貼文內容操控管理員的終端機或把網址顯示成另一個樣子
 */
export function printable(text: string, max = 100): string {
  const flat = text.replace(/[\r\n\t]+/g, ' ')
  const chars = [...flat]
  const cut = chars.length > max ? `${chars.slice(0, max).join('')}…` : flat
  return cut.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`)
}

export const formatTime = (date: Date | null) => date?.toISOString().replace(/\.\d+Z$/, 'Z') ?? '-'

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

/** 一筆內容一行：類型、代碼、建立時間、IP、狀態，再接目的地或貼文開頭 */
export function formatContentRow(row: ContentRow): string {
  const flags = [
    row.disabled && '[disabled]',
    row.threats && `[safe browsing: ${row.threats.join(', ')}]`,
    row.expired && '[expired]',
  ]
    .filter(Boolean)
    .join(' ')
  const detail =
    row.kind === 'link'
      ? printable(row.summary)
      : `${row.language ?? '-'} ${formatBytes(row.bytes ?? 0)}  "${printable(row.summary, 60)}"`
  return [row.kind.padEnd(5), row.code.padEnd(7), formatTime(row.createdAt), (row.creatorIp ?? '-').padEnd(15), flags, detail]
    .filter(Boolean)
    .join('  ')
}

import { and, count, eq, gt, isNotNull, isNull, max, min, or, sql } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { CODE_PATTERN } from './code.js'
import type { Target } from './takedown.js'

const { links, pastes, reports } = schema

const tableOf = (kind: Target['kind']) => (kind === 'link' ? links : pastes)
const targetColumn = (kind: Target['kind']) => (kind === 'link' ? reports.linkId : reports.pasteId)

// 可以被檢舉的內容：存在而且還沒過期（已下架的也算，由呼叫端決定要不要記錄）
export async function findReportTarget(target: Target) {
  if (!CODE_PATTERN.test(target.code)) return undefined
  const table = tableOf(target.kind)
  const [row] = await db
    .select({ id: table.id, disabled: table.disabled })
    .from(table)
    .where(and(eq(table.code, target.code), or(isNull(table.expiresAt), gt(table.expiresAt, sql`now()`))))
    .limit(1)
  return row
}

// 檢舉依對象分組，最多人檢舉的在前面；預設只列未處理的
export async function listReports({ all = false } = {}) {
  const groups = []
  for (const kind of ['link', 'paste'] as const) {
    const table = tableOf(kind)
    const column = targetColumn(kind)
    const rows = await db
      .select({
        code: table.code,
        disabled: table.disabled,
        target: kind === 'link' ? links.url : sql<string>`left(${pastes.content}, 80)`,
        reports: count(),
        open: sql<number>`(count(*) filter (where ${reports.resolvedAt} is null))::int`,
        reasons: sql<string[]>`array_agg(distinct ${reports.reason})`,
        firstAt: min(reports.createdAt),
        lastAt: max(reports.createdAt),
      })
      .from(reports)
      .innerJoin(table, eq(column, table.id))
      .where(all ? isNotNull(column) : and(isNotNull(column), isNull(reports.resolvedAt)))
      .groupBy(table.id)
    groups.push(...rows.map((row) => ({ kind, ...row })))
  }
  return groups.sort((a, b) => b.reports - a.reports || Number(b.lastAt) - Number(a.lastAt))
}

// 某筆內容的檢舉明細（admin show 用）
export async function reportsOf(target: Target) {
  const table = tableOf(target.kind)
  return db
    .select({
      reason: reports.reason,
      details: reports.details,
      reporterIp: reports.reporterIp,
      createdAt: reports.createdAt,
      resolvedAt: reports.resolvedAt,
    })
    .from(reports)
    .innerJoin(table, eq(targetColumn(target.kind), table.id))
    .where(eq(table.code, target.code))
    .orderBy(reports.createdAt)
}

// 把這筆內容未處理的檢舉標成已處理，回傳處理了幾筆
export async function resolveReports(target: Target): Promise<number> {
  const table = tableOf(target.kind)
  const column = targetColumn(target.kind)
  const rows = await db
    .update(reports)
    .set({ resolvedAt: sql`now()` })
    .where(
      and(
        isNull(reports.resolvedAt),
        eq(column, sql`(select ${table.id} from ${table} where ${table.code} = ${target.code})`),
      ),
    )
    .returning({ id: reports.id })
  return rows.length
}

import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  check,
  index,
  inet,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

export const links = pgTable(
  'links',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    code: varchar('code', { length: 16 }).notNull().unique(),
    url: text('url').notNull(),
    deleteTokenHash: text('delete_token_hash').notNull(),
    creatorIp: inet('creator_ip'),
    userId: bigint('user_id', { mode: 'number' }),
    disabled: boolean('disabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('links_expires_at_idx').on(t.expiresAt)],
)

export const pastes = pgTable(
  'pastes',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    code: varchar('code', { length: 16 }).notNull().unique(),
    content: text('content').notNull(),
    language: varchar('language', { length: 32 }),
    deleteTokenHash: text('delete_token_hash').notNull(),
    creatorIp: inet('creator_ip'),
    userId: bigint('user_id', { mode: 'number' }),
    disabled: boolean('disabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [index('pastes_expires_at_idx').on(t.expiresAt)],
)

// 使用者的檢舉。對象被刪除（使用者刪除或過期清除）時一起刪掉；下架只是 disabled，檢舉會留著
export const reports = pgTable(
  'reports',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    linkId: bigint('link_id', { mode: 'number' }).references(() => links.id, { onDelete: 'cascade' }),
    pasteId: bigint('paste_id', { mode: 'number' }).references(() => pastes.id, { onDelete: 'cascade' }),
    reason: varchar('reason', { length: 32 }).notNull(),
    details: text('details'),
    reporterIp: inet('reporter_ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    check('reports_one_target', sql`num_nonnulls(${t.linkId}, ${t.pasteId}) = 1`),
    // 同一個 IP 對同一筆內容只算一次未處理的檢舉（處理完之後可以再檢舉）
    uniqueIndex('reports_link_reporter_unique').on(t.linkId, t.reporterIp).where(sql`${t.resolvedAt} is null`),
    uniqueIndex('reports_paste_reporter_unique').on(t.pasteId, t.reporterIp).where(sql`${t.resolvedAt} is null`),
    // ON DELETE CASCADE 和依對象查詢用（上面的 unique index 只涵蓋未處理的）
    index('reports_link_id_idx').on(t.linkId),
    index('reports_paste_id_idx').on(t.pasteId),
  ],
)

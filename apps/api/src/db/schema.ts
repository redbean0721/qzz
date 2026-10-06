import {
  bigint,
  boolean,
  index,
  inet,
  pgTable,
  text,
  timestamp,
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

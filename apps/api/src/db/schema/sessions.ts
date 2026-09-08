// `sessions` (spec 02 section 3).

import { bigint, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt, timestamptz } from './columns.ts'
import { users } from './users.ts'

/** What a session carries between requests (spec 02 section 3). */
export interface SessionData {
  userId: number
  providerId: string
  createdAt: string
  lastSeenAt: string
  /** Present only when OIDC_LOGOUT_AT_IDP is on, for RP-initiated logout. */
  idToken?: string
}

/**
 * The Postgres session store. Used when REDIS_URL is unset; with Redis configured the
 * same session shape lives there instead and this table stays empty.
 *
 * The id is 32 random bytes, base64url encoded. The cookie carries only that id, signed
 * with SESSION_SECRET.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    data: jsonb('data').$type<SessionData>().notNull(),
    createdAt: createdAt(),
    lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
    /** Sign-in time plus SESSION_MAX_AGE; the absolute ceiling the cookie slides up to. */
    expiresAt: timestamptz('expires_at').notNull(),
  },
  (table) => [
    // Destroying every session of a member who was just disabled.
    index('sessions_user_id_idx').on(table.userId),
    // The sweep that removes expired rows.
    index('sessions_expires_at_idx').on(table.expiresAt),
  ],
)

export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert

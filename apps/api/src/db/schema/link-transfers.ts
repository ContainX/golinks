// `link_transfers` (spec 03 section 9.2).

import { bigint, index, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt, timestamptz } from './columns.ts'
import { links } from './links.ts'
import { users } from './users.ts'

/**
 * A one-time invitation that hands a link to a colleague without an admin and without a
 * user picker. The token itself is never stored: only its SHA-256 hash, so a leaked
 * database row cannot be replayed as an acceptance.
 */
export const linkTransfers = pgTable(
  'link_transfers',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    linkId: bigint('link_id', { mode: 'number' })
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    /** Lowercase hex SHA-256 of the 32-byte token handed to the creator. */
    tokenHash: text('token_hash').notNull().unique(),
    createdById: bigint('created_by_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    /** The link's owner when the transfer was created; acceptance rejects a change. */
    expectedOwnerId: bigint('expected_owner_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    /** Creation time plus TRANSFER_TOKEN_TTL. */
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedById: bigint('accepted_by_id', { mode: 'number' }).references(() => users.id),
    acceptedAt: timestamptz('accepted_at'),
    /** Set when the transfer is revoked or superseded by a newer one for the same link. */
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (table) => [
    // Revoking whatever else is pending for a link when a new transfer is created.
    index('link_transfers_link_id_idx').on(table.linkId),
  ],
)

export type LinkTransferRow = typeof linkTransfers.$inferSelect
export type NewLinkTransferRow = typeof linkTransfers.$inferInsert

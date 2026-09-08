// `link_visits` (spec 07 section 2.2).

import { bigint, index, pgTable, text } from 'drizzle-orm/pg-core'
import { timestamptz } from './columns.ts'
import { links } from './links.ts'
import { users } from './users.ts'

/** Where a hit came from. */
export const LINK_VISIT_SOURCES = ['browser', 'search', 'ext', 'api'] as const
export type LinkVisitSource = (typeof LINK_VISIT_SOURCES)[number]

/**
 * One recorded hit. Written off the resolver's critical path, immediately after the
 * redirect has been sent (spec 07 section 2.2); a failure to record never affects the
 * redirect.
 *
 * Rows older than VISIT_RETENTION_DAYS are deleted in batches by a scheduled job, which is
 * why `organization_id` is denormalized here and is a plain column rather than a foreign
 * key. Deleting a link deletes its visits (spec 03 section 8); the counters on `links`
 * are unaffected by retention.
 */
export const linkVisits = pgTable(
  'link_visits',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    linkId: bigint('link_id', { mode: 'number' })
      .notNull()
      .references(() => links.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    via: text('via').$type<LinkVisitSource>().notNull(),
    visitedAt: timestamptz('visited_at').notNull().defaultNow(),
  },
  (table) => [
    // The retention sweep and per-organization reporting.
    index('link_visits_organization_visited_at_idx').on(table.organizationId, table.visitedAt),
    // The visit history of one link.
    index('link_visits_link_visited_at_idx').on(table.linkId, table.visitedAt),
  ],
)

export type LinkVisitRow = typeof linkVisits.$inferSelect
export type NewLinkVisitRow = typeof linkVisits.$inferInsert

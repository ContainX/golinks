// `links` (spec 03 section 1).

import { bigint, boolean, index, pgTable, smallint, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { createdAt, TRIGRAM_OPS, timestamptz, updatedAt } from './columns.ts'
import { organizations } from './organizations.ts'
import { users } from './users.ts'

/**
 * One short link. Lookups, uniqueness, and conflict detection all use `keyword`, the
 * canonical form; the directory shows `displayKeyword` (spec 03 section 2.2).
 */
export const links = pgTable(
  'links',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    /**
     * Stored literally, including the organization's default namespace. Changing the
     * default rewrites this column for the affected links in one transaction
     * (spec 06 section 3).
     */
    namespace: text('namespace').notNull(),
    /** Canonical keyword (spec 03 section 2.2). */
    keyword: text('keyword').notNull(),
    /** Normalized as entered (spec 03 section 2.1). */
    displayKeyword: text('display_keyword').notNull(),
    /** First segment of `keyword`, the key for prefix and pattern lookups. */
    keywordPrefix: text('keyword_prefix').notNull(),
    segmentCount: smallint('segment_count').notNull(),
    /** Number of `%s` segments. Greater than zero means the link is programmatic. */
    placeholderCount: smallint('placeholder_count').notNull().default(0),
    /** At most 4096 characters, as stored after the destination rules of spec 03 section 3. */
    destination: text('destination').notNull(),
    ownerId: bigint('owner_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    isUnlisted: boolean('is_unlisted').notNull().default(false),
    /** Incremented on every hit (spec 07 section 2.1); the directory's default sort. */
    visitCount: bigint('visit_count', { mode: 'number' }).notNull().default(0),
    lastVisitedAt: timestamptz('last_visited_at'),
    createdById: bigint('created_by_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The resolver's exact lookup, and the final backstop for conflict check 1
    // (spec 03 section 6.1).
    uniqueIndex('links_organization_namespace_keyword_key').on(
      table.organizationId,
      table.namespace,
      table.keyword,
    ),
    // Pattern and prefix-fallback resolution, which start from the first segment.
    index('links_organization_namespace_prefix_idx').on(
      table.organizationId,
      table.namespace,
      table.keywordPrefix,
    ),
    // "Links owned by me" in the directory, and the owner filter of spec 03 section 10.1.
    index('links_organization_owner_idx').on(table.organizationId, table.ownerId),
    // Substring search and trigram-ranked suggestions (spec 03 section 10.2).
    index('links_display_keyword_trgm_idx').using('gin', table.displayKeyword.op(TRIGRAM_OPS)),
    index('links_destination_trgm_idx').using('gin', table.destination.op(TRIGRAM_OPS)),
  ],
)

export type LinkRow = typeof links.$inferSelect
export type NewLinkRow = typeof links.$inferInsert

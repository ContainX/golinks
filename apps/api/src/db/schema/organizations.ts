// `organizations` (spec 01 section 1.3).

import type { OrganizationSettings } from '@golinks/shared/settings'
import { sql } from 'drizzle-orm'
import { jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt, updatedAt } from './columns.ts'

/**
 * One organization. The id is a lowercase string such as `acme.com`, produced by the
 * resolution strategy in spec 01 section 1.2. Rows appear implicitly on the first sign-in
 * of one of their members; there is no sign-up flow.
 */
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  /**
   * The settings document of spec 06 section 2, validated against the shared schema on
   * every write. An empty object is a valid document: every field has a default.
   */
  settings: jsonb('settings').$type<OrganizationSettings>().notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export type OrganizationRow = typeof organizations.$inferSelect
export type NewOrganizationRow = typeof organizations.$inferInsert

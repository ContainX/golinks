// `users` (spec 01 section 2.1).

import type { UserPreferences, UserRole, UserRoleSource } from '@golinks/shared/api'
import { bigint, boolean, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { citext, createdAt, timestamptz, updatedAt } from './columns.ts'
import { organizations } from './organizations.ts'

/**
 * One member. Created on their first successful sign-in (spec 01 section 2.2) and never
 * deleted: disabling is the deprovisioning action, so foreign keys from links never dangle
 * (spec 01 section 2.4).
 */
export const users = pgTable(
  'users',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /**
     * Lowercased and trimmed, and globally unique: an address belongs to exactly one
     * organization. `citext` makes the uniqueness case-insensitive in the database rather
     * than relying on every caller to normalize first.
     */
    email: citext('email').notNull().unique(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id),
    role: text('role').$type<UserRole>().notNull().default('member'),
    /** `manual` freezes the role against recomputation at sign-in (spec 01 section 2.3). */
    roleSource: text('role_source').$type<UserRoleSource>().notNull().default('config'),
    isEnabled: boolean('is_enabled').notNull().default(true),
    /** Whitelisted keys only, owned by the member (spec 01 section 2.5). */
    preferences: jsonb('preferences').$type<UserPreferences>().notNull().default({}),
    lastLoginAt: timestamptz('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The admin user list and every ownership lookup are scoped to one organization.
    index('users_organization_id_idx').on(table.organizationId),
  ],
)

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert

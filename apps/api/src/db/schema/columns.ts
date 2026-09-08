// Column helpers shared by the table definitions.
//
// Column names are written out in snake_case; TypeScript properties stay camelCase.

import { customType, timestamp } from 'drizzle-orm/pg-core'

/**
 * Case-insensitive text, from the `citext` extension (spec 09 section 1).
 *
 * Comparisons, unique constraints, and index lookups all fold case in the database, so
 * `Ada@Widgets.test` and `ada@widgets.test` are the same value. Used for `users.email`,
 * which spec 01 section 2.1 requires to be globally unique regardless of case.
 */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext'
  },
})

/** A `timestamptz` column. Every point in time this service stores is one of these. */
export function timestamptz(name: string) {
  return timestamp(name, { withTimezone: true, mode: 'date' })
}

/** `created_at` as every table declares it. */
export function createdAt() {
  return timestamptz('created_at').notNull().defaultNow()
}

/** `updated_at` as every mutable table declares it. Kept current by the writing code. */
export function updatedAt() {
  return timestamptz('updated_at').notNull().defaultNow()
}

/** Operator class that puts a GIN index on trigrams of a text column (`pg_trgm`). */
export const TRIGRAM_OPS = 'gin_trgm_ops'

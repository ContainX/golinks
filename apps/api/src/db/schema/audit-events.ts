// `audit_events` (spec 07 section 1).

import type { AuditEventType, AuditObjectType } from '@golinks/shared/api'
import { bigint, index, jsonb, pgTable, text } from 'drizzle-orm/pg-core'
import { createdAt } from './columns.ts'
import { users } from './users.ts'

/**
 * The append-only audit trail. Rows are never updated or deleted; they are kept
 * indefinitely in v1 (spec 07 section 1.3).
 *
 * `organization_id` is a plain column rather than a foreign key, matching spec 07 section 1:
 * the trail is written on the hot path of every mutation and must not depend on another
 * table's row still being present.
 */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: text('organization_id').notNull(),
    type: text('type').$type<AuditEventType>().notNull(),
    /** The member who caused it; null for system actions such as scheduled jobs. */
    actorUserId: bigint('actor_user_id', { mode: 'number' }).references(() => users.id),
    objectType: text('object_type').$type<AuditObjectType>().notNull(),
    /** Id of the object as text, since organization ids are strings and row ids are numbers. */
    objectId: text('object_id').notNull(),
    /** Snapshot or diff, shaped by `type` (spec 07 section 1.1). */
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    /** The `X-Request-Id` of the request that caused the event, for log correlation. */
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (table) => [
    // The admin event feed, newest first.
    index('audit_events_organization_created_at_idx').on(
      table.organizationId,
      table.createdAt.desc(),
    ),
    // The history of one link, member, or organization.
    index('audit_events_organization_object_idx').on(
      table.organizationId,
      table.objectType,
      table.objectId,
    ),
  ],
)

export type AuditEventRow = typeof auditEvents.$inferSelect
export type NewAuditEventRow = typeof auditEvents.$inferInsert

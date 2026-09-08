import { z } from 'zod'
import {
  ApiIdSchema,
  CursorSchema,
  ListLimitSchema,
  listEnvelopeSchema,
  TimestampSchema,
} from './common.ts'

/** Audit events as `GET /admin/events` returns them (spec 07 section 1). */

export const AuditEventTypeSchema = z.enum([
  'user.created',
  'user.updated',
  'link.created',
  'link.updated',
  'link.deleted',
  'link.transferred',
  'transfer.created',
  'organization.settings_updated',
])
export type AuditEventType = z.infer<typeof AuditEventTypeSchema>

/** What the event happened to. */
export const AuditObjectTypeSchema = z.enum(['link', 'user', 'organization', 'transfer'])
export type AuditObjectType = z.infer<typeof AuditObjectTypeSchema>

/**
 * One append-only audit row.
 *
 * `data` is a snapshot or a diff whose shape depends on `type` (spec 07 section 1.1); it stays
 * open here so that adding an event type does not break existing clients. The organization is
 * implied by the session, so it is not repeated in the payload.
 */
export const AuditEventSchema = z.object({
  id: ApiIdSchema,
  type: AuditEventTypeSchema,
  /** The member who caused it, or null for system actions. */
  actorUserId: ApiIdSchema.nullable(),
  objectType: AuditObjectTypeSchema,
  objectId: ApiIdSchema,
  data: z.record(z.string(), z.unknown()),
  /** Correlates with the `X-Request-Id` of the request that caused it. */
  requestId: z.string().nullable(),
  createdAt: TimestampSchema,
})
export type AuditEvent = z.infer<typeof AuditEventSchema>

/** `GET /admin/events` query parameters. */
export const AdminEventsQuerySchema = z.strictObject({
  type: AuditEventTypeSchema.optional(),
  linkId: ApiIdSchema.optional(),
  userId: ApiIdSchema.optional(),
  limit: ListLimitSchema,
  cursor: CursorSchema.optional(),
})
export type AdminEventsQuery = z.infer<typeof AdminEventsQuerySchema>

/** `GET /admin/events` response. */
export const AuditEventListResponseSchema = listEnvelopeSchema(AuditEventSchema)
export type AuditEventListResponse = z.infer<typeof AuditEventListResponseSchema>

// Reading the audit trail for the admin feed (spec 07 §1.2).
//
// The trail is append-only, so a page is a window on an unchanging list: newest first, with
// the row id breaking ties between events written in the same millisecond. That pair is the
// cursor, which is why paging never repeats or skips an event however many arrive meanwhile.
//
// The filters follow the two indexes of spec 07 §1: `(organization_id, created_at desc)` for
// the unfiltered feed, `(organization_id, object_type, object_id)` for one object's history.

import type { AuditEvent, AuditEventListResponse, AuditEventType } from '@golinks/shared/api'
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm'
import type { DatabaseExecutor } from '../audit/index.ts'
import { type AuditEventRow, auditEvents } from '../db/schema/index.ts'
import { decodeListCursor, encodeListCursor } from './cursor.ts'

/** What an admin asked the feed for. */
export interface AuditEventQuery {
  organizationId: string
  type?: AuditEventType | undefined
  /** One link's history, by the id the events carry as their object. */
  linkId?: string | undefined
  /** One member: what they did, and what was done to them. */
  userId?: string | undefined
  limit: number
  /** The sort key of the last row of the previous page, already decoded. */
  after?: { createdAt: Date; id: number } | undefined
}

/** One stored row as `AuditEventSchema` describes it (spec 05 §1: ids are strings). */
export function toAuditEventResource(row: AuditEventRow): AuditEvent {
  return {
    id: String(row.id),
    type: row.type,
    actorUserId: row.actorUserId === null ? null : String(row.actorUserId),
    objectType: row.objectType,
    objectId: row.objectId,
    data: row.data,
    requestId: row.requestId,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The cursor that reaches the page after this row. */
export function auditEventCursor(row: AuditEventRow): string {
  return encodeListCursor([row.createdAt.toISOString(), String(row.id)])
}

/** Reads a cursor back into its sort key, or undefined when it was not one of ours. */
export function parseAuditEventCursor(cursor: string): { createdAt: Date; id: number } | undefined {
  const parts = decodeListCursor(cursor, 2)
  if (parts === undefined) return undefined

  const [timestamp, id] = parts
  if (timestamp === undefined || id === undefined) return undefined

  const createdAt = new Date(timestamp)
  const numericId = Number(id)
  if (Number.isNaN(createdAt.getTime()) || !Number.isSafeInteger(numericId)) return undefined
  return { createdAt, id: numericId }
}

/**
 * One page of the feed, newest first.
 *
 * A `userId` filter matches the events a member caused and the events that changed them, since
 * an admin looking a member up wants the whole story rather than half of it. `linkId` is the
 * object filter alone: a link causes nothing.
 */
export async function listAuditEvents(
  db: DatabaseExecutor,
  query: AuditEventQuery,
): Promise<AuditEventListResponse> {
  const conditions: SQL[] = [eq(auditEvents.organizationId, query.organizationId)]

  if (query.type !== undefined) conditions.push(eq(auditEvents.type, query.type))

  if (query.linkId !== undefined) {
    conditions.push(eq(auditEvents.objectType, 'link'))
    conditions.push(eq(auditEvents.objectId, query.linkId))
  }

  if (query.userId !== undefined) {
    const actorId = Number(query.userId)
    const asObject = and(eq(auditEvents.objectType, 'user'), eq(auditEvents.objectId, query.userId))
    const clause = Number.isSafeInteger(actorId)
      ? or(eq(auditEvents.actorUserId, actorId), asObject)
      : asObject
    if (clause !== undefined) conditions.push(clause)
  }

  if (query.after !== undefined) {
    const { createdAt, id } = query.after
    const clause = or(
      lt(auditEvents.createdAt, createdAt),
      and(eq(auditEvents.createdAt, createdAt), lt(auditEvents.id, id)),
    )
    if (clause !== undefined) conditions.push(clause)
  }

  // One row beyond the page is what says whether there is another page, without a second query.
  const rows = await db
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(query.limit + 1)

  const page = rows.slice(0, query.limit)
  const last = page[page.length - 1]
  return {
    items: page.map(toAuditEventResource),
    nextCursor: rows.length > query.limit && last !== undefined ? auditEventCursor(last) : null,
  }
}

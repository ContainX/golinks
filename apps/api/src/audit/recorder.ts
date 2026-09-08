// Writing the append-only audit trail (spec 07 §1).
//
// Every mutation records its event on the same handle that made the change, so the two
// commit together or not at all. Nothing here reads: the admin feed of spec 07 §1.2 is a
// separate concern.

import type { AuditEventType, AuditObjectType } from '@golinks/shared/api'
import { type AuditEventRow, auditEvents } from '../db/schema/index.ts'
import type { AuditEventDescriptor } from './builders.ts'
import type { DatabaseExecutor } from './database.ts'

/** Who caused an event and which request it belongs to. */
export interface AuditActor {
  organizationId: string
  /** The member behind the change; null for system actions such as scheduled jobs. */
  actorUserId: number | null
  /** The `X-Request-Id` the change arrived on, for correlation with the logs. */
  requestId?: string | null
}

export interface AuditEventInput extends AuditActor {
  type: AuditEventType
  objectType: AuditObjectType
  /** Row ids are numbers and organization ids are strings; both are stored as text. */
  objectId: string | number
  data?: Record<string, unknown>
}

/** Appends one event. Never updates or deletes: the trail is history (spec 07 §1). */
export async function recordAuditEvent(
  tx: DatabaseExecutor,
  input: AuditEventInput,
): Promise<AuditEventRow> {
  const rows = await tx
    .insert(auditEvents)
    .values({
      organizationId: input.organizationId,
      type: input.type,
      actorUserId: input.actorUserId,
      objectType: input.objectType,
      objectId: String(input.objectId),
      data: input.data ?? {},
      requestId: input.requestId ?? null,
    })
    .returning()

  const row = rows[0]
  if (row === undefined) throw new Error('Recording an audit event returned no row.')
  return row
}

/**
 * Appends the events a change produced, in order, skipping the builders that found nothing
 * to report. One change can produce more than one event: renaming a link and handing it to
 * a colleague in the same request is a `link.updated` and a `link.transferred`.
 */
export async function recordAuditEvents(
  tx: DatabaseExecutor,
  actor: AuditActor,
  descriptors: readonly (AuditEventDescriptor | null)[],
): Promise<AuditEventRow[]> {
  const written: AuditEventRow[] = []
  for (const descriptor of descriptors) {
    if (descriptor === null) continue
    written.push(await recordAuditEvent(tx, { ...actor, ...descriptor }))
  }
  return written
}

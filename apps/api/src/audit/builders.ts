// The payload of every audit event type (spec 07 §1.1).
//
// A builder turns rows into the `{ type, objectType, objectId, data }` an event carries and
// says nothing about who caused it or when; `recordAuditEvent` adds the actor, the request
// id, and the organization. Builders that describe a change return `null` when nothing they
// track actually moved, so a no-op update writes no row.
//
// Ids inside `data` are strings, the convention every identifier travels under in this API
// (spec 05 §1), and timestamps are ISO 8601 strings, so a payload survives a round trip
// through jsonb unchanged.

import type { AuditEventType, AuditObjectType } from '@golinks/shared/api'
import type { OrganizationSettings } from '@golinks/shared/settings'
import type { LinkRow, LinkTransferRow, UserRow } from '../db/schema/index.ts'

/** One event, ready for `recordAuditEvent` to stamp with an actor and store. */
export interface AuditEventDescriptor {
  type: AuditEventType
  objectType: AuditObjectType
  objectId: string
  data: Record<string, unknown>
}

/** A field that moved, as `[previous, current]` (spec 07 §1.1). */
export type AuditChange<Value> = [Value, Value]

/** How a link changed hands (spec 03 §9). */
export type LinkTransferMethod = 'direct' | 'transferLink'

/** The link fields whose changes `link.updated` records. */
const AUDITED_LINK_FIELDS = [
  'namespace',
  'keyword',
  'displayKeyword',
  'destination',
  'isUnlisted',
] as const satisfies readonly (keyof LinkRow)[]

/** The user fields whose changes `user.updated` records (spec 07 §1.1). */
const AUDITED_USER_FIELDS = ['role', 'isEnabled'] as const satisfies readonly (keyof UserRow)[]

/** The settings fields whose changes `organization.settings_updated` records. */
const AUDITED_SETTINGS_FIELDS = [
  'defaultNamespace',
  'namespaces',
  'keywords',
  'editMode',
  'readOnly',
  'admins',
  'banner',
  'branding',
  'navigationLinks',
] as const satisfies readonly (keyof OrganizationSettings)[]

/** A link as `link.created` and `link.deleted` preserve it. */
export interface LinkSnapshot {
  id: string
  namespace: string
  keyword: string
  displayKeyword: string
  fullPath: string
  destination: string
  isProgrammatic: boolean
  placeholderCount: number
  segmentCount: number
  isUnlisted: boolean
  ownerId: string
  createdById: string
  visitCount: number
  lastVisitedAt: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Everything about a link worth keeping once the row itself may be gone (spec 03 §8), in
 * the vocabulary the API uses rather than the column names of the table.
 */
export function linkSnapshot(link: LinkRow): LinkSnapshot {
  return {
    id: String(link.id),
    namespace: link.namespace,
    keyword: link.keyword,
    displayKeyword: link.displayKeyword,
    fullPath: `${link.namespace}/${link.displayKeyword}`,
    destination: link.destination,
    isProgrammatic: link.placeholderCount > 0,
    placeholderCount: link.placeholderCount,
    segmentCount: link.segmentCount,
    isUnlisted: link.isUnlisted,
    ownerId: String(link.ownerId),
    createdById: String(link.createdById),
    visitCount: link.visitCount,
    lastVisitedAt: link.lastVisitedAt?.toISOString() ?? null,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  }
}

/** Structural equality, so that a settings sub-document counts as changed only when it did. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (typeof left !== 'object' || typeof right !== 'object') return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    return (
      left.length === right.length && left.every((item, index) => sameValue(item, right[index]))
    )
  }

  const leftEntries = Object.entries(left as Record<string, unknown>)
  const rightRecord = right as Record<string, unknown>
  if (leftEntries.length !== Object.keys(rightRecord).length) return false
  return leftEntries.every(
    ([key, value]) => key in rightRecord && sameValue(value, rightRecord[key]),
  )
}

/** The `[old, new]` pairs for the fields that moved, or `null` when none did. */
function diffFields<Source>(
  before: Source,
  after: Source,
  fields: readonly (keyof Source)[],
): Record<string, AuditChange<unknown>> | null {
  const changes: Record<string, AuditChange<unknown>> = {}
  for (const field of fields) {
    if (sameValue(before[field], after[field])) continue
    changes[String(field)] = [before[field], after[field]]
  }
  return Object.keys(changes).length === 0 ? null : changes
}

/** `link.created`: the whole link, as it was written (spec 07 §1.1). */
export function linkCreatedEvent(link: LinkRow): AuditEventDescriptor {
  return {
    type: 'link.created',
    objectType: 'link',
    objectId: String(link.id),
    data: { ...linkSnapshot(link) },
  }
}

/**
 * `link.updated`: the fields that moved and what they held before (spec 03 §7).
 *
 * A change of owner is a transfer rather than an update, so it gets its own event
 * (spec 03 §9.1) and is not part of these changes. `displayKeyword` is tracked beside
 * `keyword` because a rename inside a punctuation-insensitive organization can change what
 * the directory shows while the canonical keyword stays where it was.
 */
export function linkUpdatedEvent(before: LinkRow, after: LinkRow): AuditEventDescriptor | null {
  const changes = diffFields(before, after, AUDITED_LINK_FIELDS)
  if (changes === null) return null
  return {
    type: 'link.updated',
    objectType: 'link',
    objectId: String(after.id),
    data: { changes },
  }
}

/** `link.deleted`: the snapshot the audit trail keeps once the row is gone (spec 03 §8). */
export function linkDeletedEvent(link: LinkRow): AuditEventDescriptor {
  return {
    type: 'link.deleted',
    objectType: 'link',
    objectId: String(link.id),
    data: { ...linkSnapshot(link) },
  }
}

export interface LinkTransfer {
  fromUserId: number
  toUserId: number
  /** `direct` for an admin assignment (spec 03 §9.1), `transferLink` for an acceptance. */
  method: LinkTransferMethod
}

/** `link.transferred`: who handed the link to whom, and how (spec 03 §9). */
export function linkTransferredEvent(
  link: Pick<LinkRow, 'id'>,
  transfer: LinkTransfer,
): AuditEventDescriptor {
  return {
    type: 'link.transferred',
    objectType: 'link',
    objectId: String(link.id),
    data: {
      fromUserId: String(transfer.fromUserId),
      toUserId: String(transfer.toUserId),
      method: transfer.method,
    },
  }
}

/** `transfer.created`: a pending transfer link and when it stops working (spec 03 §9.2). */
export function transferCreatedEvent(
  transfer: Pick<LinkTransferRow, 'id' | 'linkId' | 'expiresAt'>,
): AuditEventDescriptor {
  return {
    type: 'transfer.created',
    objectType: 'transfer',
    objectId: String(transfer.id),
    data: { linkId: String(transfer.linkId), expiresAt: transfer.expiresAt.toISOString() },
  }
}

/** `user.created`: a member appearing on their first sign-in (spec 01 §2.2). */
export function userCreatedEvent(user: UserRow): AuditEventDescriptor {
  return {
    type: 'user.created',
    objectType: 'user',
    objectId: String(user.id),
    data: { email: user.email, organizationId: user.organizationId, role: user.role },
  }
}

/** `user.updated`: a role or enablement change (spec 07 §1.1). */
export function userUpdatedEvent(before: UserRow, after: UserRow): AuditEventDescriptor | null {
  const changes = diffFields(before, after, AUDITED_USER_FIELDS)
  if (changes === null) return null
  return {
    type: 'user.updated',
    objectType: 'user',
    objectId: String(after.id),
    data: { changes },
  }
}

/** `organization.settings_updated`: the settings fields an admin moved (spec 06 §2). */
export function organizationSettingsUpdatedEvent(
  organizationId: string,
  before: OrganizationSettings,
  after: OrganizationSettings,
): AuditEventDescriptor | null {
  const changes = diffFields(before, after, AUDITED_SETTINGS_FIELDS)
  if (changes === null) return null
  return {
    type: 'organization.settings_updated',
    objectType: 'organization',
    objectId: organizationId,
    data: { changes },
  }
}

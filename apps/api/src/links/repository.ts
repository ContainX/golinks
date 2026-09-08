// Reading and writing the `links` table (spec 03 §1).
//
// Every function takes the handle it runs on, so a caller can run several of them inside
// one transaction, and every one of them is scoped to an organization: a link belonging to
// another tenant reads as missing rather than as forbidden, which is what lets the
// endpoints answer 404 without leaking that an id exists (spec 03 §5).
//
// The writes carry the audit trail with them: `updateLink` and `deleteLink` record their
// events on the same handle as the change (spec 07 §1), so the two commit together.

import type { EvaluatedKeyword } from '@golinks/shared/keywords'
import { and, asc, eq, gt, ne } from 'drizzle-orm'
import {
  type AuditActor,
  type DatabaseExecutor,
  type LinkTransferMethod,
  linkDeletedEvent,
  linkTransferredEvent,
  linkUpdatedEvent,
  recordAuditEvents,
} from '../audit/index.ts'
import { type LinkRow, links, users } from '../db/schema/index.ts'
import type { LinkOwnerSource } from './resource.ts'

/** Who a write is attributed to in the audit trail (spec 07 §1). */
export interface LinkAuditContext {
  actorUserId: number | null
  requestId?: string | null
  /** How the link changed hands when the owner moves; `direct` by default (spec 03 §9.1). */
  transferMethod?: LinkTransferMethod
}

/** Narrowing for `findByPrefix`, which serves both conflict detection and resolution. */
export interface PrefixLookup {
  /** Only links with at least one `%s` segment. */
  programmaticOnly?: boolean
  /** Only links with exactly this many segments, as pattern matching requires. */
  segmentCount?: number
  /** Skip this link, so that a rename never conflicts with itself (spec 03 §7). */
  excludeLinkId?: number
}

/** The unique-index lookup: one organization, one namespace, one canonical keyword. */
export async function findExact(
  db: DatabaseExecutor,
  organizationId: string,
  namespace: string,
  canonicalKeyword: string,
): Promise<LinkRow | undefined> {
  const rows = await db
    .select()
    .from(links)
    .where(
      and(
        eq(links.organizationId, organizationId),
        eq(links.namespace, namespace),
        eq(links.keyword, canonicalKeyword),
      ),
    )
    .limit(1)
  return rows[0]
}

/**
 * Every link in the namespace whose first segment is `prefix`, ordered by keyword ascending
 * so that two callers looking at the same data reach the same link (spec 04 §5.2).
 */
export async function findByPrefix(
  db: DatabaseExecutor,
  organizationId: string,
  namespace: string,
  prefix: string,
  lookup: PrefixLookup = {},
): Promise<LinkRow[]> {
  const conditions = [
    eq(links.organizationId, organizationId),
    eq(links.namespace, namespace),
    eq(links.keywordPrefix, prefix),
  ]
  if (lookup.programmaticOnly === true) conditions.push(gt(links.placeholderCount, 0))
  if (lookup.segmentCount !== undefined) {
    conditions.push(eq(links.segmentCount, lookup.segmentCount))
  }
  if (lookup.excludeLinkId !== undefined) conditions.push(ne(links.id, lookup.excludeLinkId))

  return await db
    .select()
    .from(links)
    .where(and(...conditions))
    .orderBy(asc(links.keyword))
}

/** One link by id, within one organization. Another tenant's id reads as missing. */
export async function findById(
  db: DatabaseExecutor,
  organizationId: string,
  id: number,
): Promise<LinkRow | undefined> {
  const rows = await db
    .select()
    .from(links)
    .where(and(eq(links.organizationId, organizationId), eq(links.id, id)))
    .limit(1)
  return rows[0]
}

/** The owner of a link, for the resource shape. Scoped to the organization like everything. */
export async function findLinkOwner(
  db: DatabaseExecutor,
  organizationId: string,
  userId: number,
): Promise<LinkOwnerSource | undefined> {
  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(eq(users.organizationId, organizationId), eq(users.id, userId)))
    .limit(1)
  return rows[0]
}

/** The denormalized keyword columns a keyword evaluation produces (spec 03 §1). */
export interface KeywordColumns {
  keyword: string
  displayKeyword: string
  keywordPrefix: string
  segmentCount: number
  placeholderCount: number
}

/** Spreads a validated keyword into the columns the table stores it in. */
export function keywordColumns(evaluation: EvaluatedKeyword): KeywordColumns {
  return {
    keyword: evaluation.canonicalKeyword,
    displayKeyword: evaluation.displayKeyword,
    keywordPrefix: evaluation.prefix,
    segmentCount: evaluation.segmentCount,
    placeholderCount: evaluation.placeholderCount,
  }
}

/** Everything a new row needs; the caller has already validated all of it. */
export interface InsertLinkValues {
  organizationId: string
  namespace: string
  keyword: string
  displayKeyword: string
  keywordPrefix: string
  segmentCount: number
  placeholderCount: number
  destination: string
  ownerId: number
  createdById: number
  isUnlisted?: boolean
}

/**
 * Inserts the row. The unique index is the last word on a duplicate keyword, so a caller
 * racing another request sees SQLSTATE 23505 here; `createLinkWithChecks` translates it.
 */
export async function insertLink(db: DatabaseExecutor, values: InsertLinkValues): Promise<LinkRow> {
  const rows = await db
    .insert(links)
    .values({ ...values, isUnlisted: values.isUnlisted ?? false })
    .returning()

  const row = rows[0]
  if (row === undefined) throw new Error('Inserting a link returned no row.')
  return row
}

/** The columns an update may move. Everything else about a link is history. */
export interface LinkChanges {
  namespace?: string
  keyword?: string
  displayKeyword?: string
  keywordPrefix?: string
  segmentCount?: number
  placeholderCount?: number
  destination?: string
  ownerId?: number
  isUnlisted?: boolean
}

/**
 * Applies the changes and records what moved: `link.updated` for the fields spec 03 §7
 * tracks, and `link.transferred` as well when the owner changed (spec 03 §9.1). Both land
 * on the same handle as the update.
 */
export async function updateLink(
  db: DatabaseExecutor,
  before: LinkRow,
  changes: LinkChanges,
  audit: LinkAuditContext,
): Promise<LinkRow> {
  const rows = await db
    .update(links)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(links.organizationId, before.organizationId), eq(links.id, before.id)))
    .returning()

  const after = rows[0]
  if (after === undefined) throw new Error(`Link ${before.id} disappeared during an update.`)

  await recordAuditEvents(db, auditActorFor(before.organizationId, audit), [
    linkUpdatedEvent(before, after),
    before.ownerId === after.ownerId
      ? null
      : linkTransferredEvent(after, {
          fromUserId: before.ownerId,
          toUserId: after.ownerId,
          method: audit.transferMethod ?? 'direct',
        }),
  ])

  return after
}

/**
 * Deletes the link permanently, its visits and pending transfers going with it through the
 * foreign keys (spec 03 §8). The `link.deleted` snapshot is written first, so the trail
 * keeps what the row held.
 */
export async function deleteLink(
  db: DatabaseExecutor,
  link: LinkRow,
  audit: LinkAuditContext,
): Promise<void> {
  await recordAuditEvents(db, auditActorFor(link.organizationId, audit), [linkDeletedEvent(link)])

  await db
    .delete(links)
    .where(and(eq(links.organizationId, link.organizationId), eq(links.id, link.id)))
}

function auditActorFor(organizationId: string, audit: LinkAuditContext): AuditActor {
  return {
    organizationId,
    actorUserId: audit.actorUserId,
    requestId: audit.requestId ?? null,
  }
}

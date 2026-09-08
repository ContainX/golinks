// Reading and writing the `users` table for the admin endpoints (spec 01 §2, spec 05 §3).
//
// Every query is scoped to one organization: a member of another tenant reads as missing, so
// `GET /admin/users/:id` can answer 404 without confirming that an id exists somewhere else
// (spec 03 §5 applies the same rule to links).
//
// The link count comes from a grouped subquery joined onto the page, so a page of members costs
// one query however many of them there are, and a member who owns nothing still appears.

import type { UserRole } from '@golinks/shared/api'
import { and, asc, count, eq, gt, ilike, type SQL, sql } from 'drizzle-orm'
import type { DatabaseExecutor } from '../audit/index.ts'
import { recordAuditEvents, userUpdatedEvent } from '../audit/index.ts'
import type { Database } from '../db/client.ts'
import { links, type UserRow, users } from '../db/schema/index.ts'
import type { AdminUserRecord } from './resource.ts'

/** The filters of `GET /admin/users` (spec 05 §3). */
export interface AdminUserListQuery {
  organizationId: string
  /** Substring of the email address, matched case-insensitively. */
  q?: string | undefined
  role?: UserRole | undefined
  enabled?: boolean | undefined
  /** How many rows to read. Callers ask for one more than the page to detect a next page. */
  limit: number
  /** The email of the last row of the previous page. */
  afterEmail?: string | undefined
}

/** What an admin may change about a member (spec 01 §2.3, §2.4). */
export interface UserChanges {
  isEnabled?: boolean
  role?: UserRole
  /** Set to `manual` alongside a role change, which freezes it against sign-in. */
  roleSource?: 'config' | 'idp' | 'manual'
}

/** Who a write is attributed to in the audit trail (spec 07 §1). */
export interface UserAuditContext {
  actorUserId: number | null
  requestId?: string | null
}

/** `%` and `_` are wildcards in `LIKE`, so a member searching for `a_b` means those characters. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}

/**
 * Members of the organization with their link counts, ordered by email.
 *
 * Email is unique (spec 01 §2.1), so ordering by it is a total order and the last email on a
 * page is a cursor that can neither repeat nor skip a member.
 */
export async function listAdminUsers(
  db: Database,
  query: AdminUserListQuery,
): Promise<AdminUserRecord[]> {
  const conditions: SQL[] = []
  if (query.q !== undefined && query.q.length > 0) {
    conditions.push(ilike(users.email, `%${escapeLikePattern(query.q)}%`))
  }
  if (query.role !== undefined) conditions.push(eq(users.role, query.role))
  if (query.enabled !== undefined) conditions.push(eq(users.isEnabled, query.enabled))
  if (query.afterEmail !== undefined) conditions.push(gt(users.email, query.afterEmail))

  return await selectAdminUsers(db, query.organizationId, conditions, query.limit)
}

/** One member of the organization, with their link count. Another tenant's id reads as missing. */
export async function findAdminUser(
  db: Database,
  organizationId: string,
  id: number,
): Promise<AdminUserRecord | undefined> {
  const rows = await selectAdminUsers(db, organizationId, [eq(users.id, id)], 1)
  return rows[0]
}

/**
 * The one query behind both endpoints: members of the organization, ordered by email, each
 * with the number of links they own.
 *
 * The counts come from a grouped subquery joined onto the page rather than a count per row, so
 * the cost does not grow with the size of the page, and a member who owns nothing still
 * appears — the join simply finds no row for them.
 */
async function selectAdminUsers(
  db: Database,
  organizationId: string,
  conditions: readonly SQL[],
  limit: number,
): Promise<AdminUserRecord[]> {
  const linkCounts = db
    .select({ ownerId: links.ownerId, linkCount: count().as('link_count') })
    .from(links)
    .where(eq(links.organizationId, organizationId))
    .groupBy(links.ownerId)
    .as('link_counts')

  const rows = await db
    .select({
      user: users,
      linkCount: sql<number>`coalesce(${linkCounts.linkCount}, 0)`.mapWith(Number),
    })
    .from(users)
    .leftJoin(linkCounts, eq(linkCounts.ownerId, users.id))
    .where(and(eq(users.organizationId, organizationId), ...conditions))
    .orderBy(asc(users.email))
    .limit(limit)

  return rows.map((row) => ({ user: row.user, linkCount: row.linkCount }))
}

/**
 * Applies the changes and records `user.updated` with them on the same handle, so the change
 * and its audit row commit together (spec 07 §1.1).
 */
export async function updateUserRow(
  db: DatabaseExecutor,
  before: UserRow,
  changes: UserChanges,
  audit: UserAuditContext,
): Promise<UserRow> {
  const rows = await db
    .update(users)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(users.organizationId, before.organizationId), eq(users.id, before.id)))
    .returning()

  const after = rows[0]
  if (after === undefined) throw new Error(`User ${before.id} disappeared during an update.`)

  await recordAuditEvents(
    db,
    {
      organizationId: before.organizationId,
      actorUserId: audit.actorUserId,
      requestId: audit.requestId ?? null,
    },
    [userUpdatedEvent(before, after)],
  )

  return after
}

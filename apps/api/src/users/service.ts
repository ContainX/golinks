// The admin user endpoints as rules rather than routes (spec 01 §2.3-2.4, spec 05 §3).
//
// Two of them are worth stating plainly. An admin may not disable or demote themselves, so an
// organization can never be left without anyone able to administer it: the API answers
// `cannot_modify_self` whenever the target of a change is the caller. And a role set here is a
// deliberate decision, so it is stored with `role_source` `manual`, which is what stops the
// next sign-in recomputing it away (spec 01 §2.3).

import type {
  AdminUser,
  AdminUserListResponse,
  AdminUserPatchBody,
  AdminUsersQuery,
} from '@golinks/shared/api'
import { decodeListCursor, encodeListCursor } from '../admin/cursor.ts'
import type { Database } from '../db/client.ts'
import { ApiError, notFound, validationFailed } from '../errors.ts'
import type { CurrentMember } from '../types.ts'
import { findAdminUser, listAdminUsers, type UserChanges, updateUserRow } from './repository.ts'
import { type AdminUserRecord, parseUserId, toAdminUser } from './resource.ts'

/** What a change to a member arrives with. */
export interface ChangeUserInput {
  organizationId: string
  /** The member being changed, as the URL names them. */
  id: string
  changes: AdminUserPatchBody
  /** The admin making the change. */
  actor: CurrentMember
  requestId?: string | null
}

/** One page of the organization's members (spec 05 §3). */
export async function listOrganizationUsers(
  db: Database,
  organizationId: string,
  query: AdminUsersQuery,
): Promise<AdminUserListResponse> {
  const afterEmail = readUserCursor(query.cursor)

  // One row beyond the page says whether there is another page, without a second query.
  const records = await listAdminUsers(db, {
    organizationId,
    q: query.q,
    role: query.role,
    enabled: query.enabled,
    limit: query.limit + 1,
    afterEmail,
  })

  const page = records.slice(0, query.limit)
  const last = page[page.length - 1]
  return {
    items: page.map(toAdminUser),
    nextCursor:
      records.length > query.limit && last !== undefined
        ? encodeListCursor([last.user.email])
        : null,
  }
}

/** One member of the caller's organization, or 404 for anyone else's (spec 05 §4). */
export async function readOrganizationUser(
  db: Database,
  organizationId: string,
  id: string,
): Promise<AdminUser> {
  return toAdminUser(await loadMember(db, organizationId, id))
}

/**
 * Enables, disables, or re-roles a member (spec 01 §2.3-2.4).
 *
 * A change that asks for what is already stored writes nothing and records nothing, so the
 * audit trail keeps only the moments a member actually moved.
 */
export async function changeOrganizationUser(
  db: Database,
  input: ChangeUserInput,
): Promise<AdminUser> {
  const record = await loadMember(db, input.organizationId, input.id)
  const { user } = record

  if (String(user.id) === input.actor.id) {
    throw new ApiError(
      'cannot_modify_self',
      'An administrator cannot change their own role or disable their own account.',
    )
  }

  const changes: UserChanges = {}
  if (input.changes.isEnabled !== undefined && input.changes.isEnabled !== user.isEnabled) {
    changes.isEnabled = input.changes.isEnabled
  }
  if (input.changes.role !== undefined && input.changes.role !== user.role) {
    changes.role = input.changes.role
    // Spec 01 §2.3: a hand-set role outlives every later sign-in.
    changes.roleSource = 'manual'
  }
  if (Object.keys(changes).length === 0) return toAdminUser(record)

  const actorUserId = Number(input.actor.id)
  await db.transaction(async (tx) => {
    await updateUserRow(tx, user, changes, {
      actorUserId: Number.isSafeInteger(actorUserId) ? actorUserId : null,
      requestId: input.requestId ?? null,
    })
  })

  const updated = await findAdminUser(db, input.organizationId, user.id)
  if (updated === undefined) throw notFound('That member no longer exists.')
  return toAdminUser(updated)
}

/** The member the URL names, within the caller's organization. */
async function loadMember(
  db: Database,
  organizationId: string,
  id: string,
): Promise<AdminUserRecord> {
  const userId = parseUserId(id)
  const record = userId === undefined ? undefined : await findAdminUser(db, organizationId, userId)
  if (record === undefined) throw notFound('That member does not exist in your organization.')
  return record
}

/** The email a cursor carries, or a `validation_failed` when it was not one of ours. */
function readUserCursor(cursor: string | undefined): string | undefined {
  if (cursor === undefined) return undefined
  const parts = decodeListCursor(cursor, 1)
  if (parts === undefined) throw validationFailed({ cursor: 'That cursor did not come from us.' })
  return parts[0]
}

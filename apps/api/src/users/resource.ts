// Turning a stored member into the resource the admin console reads (spec 05 §2.3).
//
// The admin view is the only place a member's role source, enablement, and link count are
// visible; `GET /me` shows a member their own row and nothing about anyone else (spec 01 §2.6).

import type { AdminUser } from '@golinks/shared/api'
import type { UserRow } from '../db/schema/index.ts'

/** A member and how many links they own, which is what an admin needs before disabling them. */
export interface AdminUserRecord {
  user: UserRow
  linkCount: number
}

/** One member as the admin endpoints return them. Ids are strings, times ISO 8601 (spec 05 §1). */
export function toAdminUser(record: AdminUserRecord): AdminUser {
  const { user, linkCount } = record
  return {
    id: String(user.id),
    email: user.email,
    role: user.role,
    roleSource: user.roleSource,
    isEnabled: user.isEnabled,
    linkCount,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  }
}

/**
 * Reads an id off the URL. Row ids are bigints travelling as strings, so anything that is not
 * one names no member at all and the caller answers 404 rather than asking the database.
 */
export function parseUserId(value: string): number | undefined {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return undefined
  return parsed
}

// Admin determination (spec 01 §2.3).
//
// The effective role is recomputed on every sign-in from three sources — the organization's
// `admins` setting, the deployment's INITIAL_ADMIN_EMAILS, and the identity provider's groups —
// unless an admin has set the role by hand, which freezes it. Pure: everything it needs is
// passed in, so the precedence rules are tested without a database or a provider.

import type { UserRole, UserRoleSource } from '@golinks/shared/api'

/** The stored role and where it came from. */
export interface RoleDecision {
  role: UserRole
  roleSource: UserRoleSource
}

export interface RoleInputs {
  /** The member's normalized email address. */
  email: string
  /** Group names the identity provider asserted for this sign-in. */
  groups?: readonly string[] | undefined
  /** Group names that confer the admin role, from the provider's `adminGroups`. */
  adminGroups?: readonly string[] | undefined
  /** The organization's `admins` setting (spec 06). */
  settingsAdmins?: readonly string[] | undefined
  /** The deployment's INITIAL_ADMIN_EMAILS, which is how a fresh install gets its first admin. */
  initialAdminEmails?: readonly string[] | undefined
  /** What is stored today, or undefined for a member signing in for the first time. */
  current?: RoleDecision | undefined
}

function normalizedSet(values: readonly string[] | undefined): ReadonlySet<string> {
  const set = new Set<string>()
  for (const value of values ?? []) {
    const normalized = value.trim().toLowerCase()
    if (normalized.length > 0) set.add(normalized)
  }
  return set
}

/** Whether the address is named as an admin by configuration, in either place it can be. */
export function isConfiguredAdmin(inputs: RoleInputs): boolean {
  const email = inputs.email.trim().toLowerCase()
  return (
    normalizedSet(inputs.settingsAdmins).has(email) ||
    normalizedSet(inputs.initialAdminEmails).has(email)
  )
}

/** Whether the provider put the member in one of the groups that confer the admin role. */
export function isGroupAdmin(inputs: RoleInputs): boolean {
  const adminGroups = normalizedSet(inputs.adminGroups)
  if (adminGroups.size === 0) return false
  for (const group of inputs.groups ?? []) {
    if (adminGroups.has(group.trim().toLowerCase())) return true
  }
  return false
}

/**
 * The role this sign-in leaves the member with (spec 01 §2.3).
 *
 * A `manual` role wins over everything: it is a deliberate decision by another admin through
 * the admin API, and recomputing it would undo that on the member's next visit. Otherwise
 * configuration is checked before groups, so `role_source` reads `config` whenever the address
 * is listed and `idp` only when the group membership is what decided it. A member who is
 * neither is recorded as `config`, since configuration is what left them a member.
 */
export function computeRole(inputs: RoleInputs): RoleDecision {
  const current = inputs.current
  if (current?.roleSource === 'manual') return { role: current.role, roleSource: 'manual' }

  if (isConfiguredAdmin(inputs)) return { role: 'admin', roleSource: 'config' }
  if (isGroupAdmin(inputs)) return { role: 'admin', roleSource: 'idp' }
  return { role: 'member', roleSource: 'config' }
}

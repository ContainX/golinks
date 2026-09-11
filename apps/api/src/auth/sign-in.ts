// Completing a sign-in (spec 01 §§1.2, 2.2-2.4 and spec 02 §2).
//
// Everything that authenticates a member ends here: the OIDC callback of spec 02 §2 and the
// test sign-in of spec 02 §8 both hand over a verified email, the provider that vouched for it,
// and any groups it asserted, and get back the member the request now acts as. Doing it in one
// place is what keeps the two paths honest with each other — organization resolution, the
// allowlist, the upsert, the role, and the session are decided once.
//
// Every refusal is a `SignInError` carrying one of the codes of spec 02 §2.1, so the callback
// can redirect to `/_/auth/login?error=<code>` without interpreting anything.

import { resolveOrganizationId } from '@golinks/shared/organizations'
import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { recordAuditEvent } from '../audit/index.ts'
import type { Database } from '../db/client.ts'
import { type UserRow, users } from '../db/schema/index.ts'
import type { CurrentMember } from '../types.ts'
import { SignInError } from './errors.ts'
import { memberCacheOf } from './member-cache.ts'
import { sessionOf } from './member-resolver.ts'
import { computeRole, type RoleDecision } from './roles.ts'

/** What a provider vouched for. */
export interface SignInIdentity {
  /** The address the provider returned, before normalization. */
  email: unknown
  /** The provider slug the sign-in came through, for example `okta`. */
  providerId: string
  /** Group names the provider asserted, used for admin mapping (spec 01 §2.3). */
  groups?: readonly string[] | undefined
  /** Group names that confer the admin role, from the provider's `adminGroups`. */
  adminGroups?: readonly string[] | undefined
  /** The `email_verified` claim as it arrived, if the source carried one (spec 02 §2). */
  emailVerified?: unknown
  /** Kept in the session when OIDC_LOGOUT_AT_IDP is on, for RP-initiated sign-out. */
  idToken?: string | undefined
}

export interface SignInOutcome {
  /** The member the request now acts as. */
  member: CurrentMember
  /** True when this sign-in created the row, which is what emits `user.created`. */
  isFirstSignIn: boolean
  /** Where the stored role came from after recomputation. */
  roleSource: RoleDecision['roleSource']
}

export interface CompleteSignInOptions {
  /** Clock, injectable so a test can place `last_login_at` and the session's age precisely. */
  now?: () => number
}

/** Strings a provider uses to say an address is not verified (spec 02 §2). */
const UNVERIFIED_STRINGS = new Set(['false', '0', 'no'])

/**
 * Trims and lowercases the address, refusing anything that is not shaped like one.
 * A provider that returns no usable address is `email_missing` (spec 02 §2.1).
 */
export function normalizeSignInEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1 || /\s/.test(email)) {
    throw new SignInError('email_missing', {
      message: 'The identity provider returned no usable email address.',
    })
  }
  return email
}

/** An absent claim is accepted; a present one that says no is a refusal (spec 02 §2). */
export function isEmailUnverified(claim: unknown): boolean {
  if (claim === undefined || claim === null) return false
  if (typeof claim === 'boolean') return !claim
  if (typeof claim === 'string') return UNVERIFIED_STRINGS.has(claim.trim().toLowerCase())
  return false
}

async function findUserByEmail(db: Database, email: string): Promise<UserRow | undefined> {
  // `users.email` is citext, so the comparison folds case in the database.
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  return rows[0]
}

function memberOf(row: UserRow): CurrentMember {
  return {
    id: String(row.id),
    email: row.email,
    organizationId: row.organizationId,
    role: row.role,
  }
}

/**
 * Runs the sign-in of spec 02 §2 steps 5 to 8 and opens the session.
 *
 * The organization is resolved from the address for a member who has never signed in; one who
 * has keeps the organization their row already names, since spec 01 §2.1 makes an address
 * belong to exactly one organization and their links hang off it.
 */
export async function completeSignIn(
  request: FastifyRequest,
  identity: SignInIdentity,
  options: CompleteSignInOptions = {},
): Promise<SignInOutcome> {
  const now = options.now ?? Date.now
  const app = request.server
  const config = app.appConfig
  const db = app.db
  const settingsService = app.organizationSettings

  const email = normalizeSignInEmail(identity.email)
  if (isEmailUnverified(identity.emailVerified)) throw new SignInError('email_unverified')

  const resolution = resolveOrganizationId(email, {
    strategy: config.organizations.resolution,
    ...(config.organizations.fixedId === undefined
      ? {}
      : { fixedId: config.organizations.fixedId }),
    aliases: config.organizations.domainAliases,
    allowedIds: config.organizations.allowedIds,
  })
  if (!resolution.ok) {
    if (resolution.code === 'org_not_allowed') {
      throw new SignInError('org_not_allowed', { message: resolution.message })
    }
    // The address is already known to be well formed, so the only way left to be unresolvable
    // is a deployment configured for a fixed organization without naming one.
    request.log.error({ email }, resolution.message)
    throw new SignInError('provider_error', { message: resolution.message })
  }
  const resolvedOrganizationId = resolution.organizationId

  async function decide(
    organizationId: string,
    current: RoleDecision | undefined,
  ): Promise<RoleDecision> {
    const settings = await settingsService.getSettings(organizationId)
    return computeRole({
      email,
      groups: identity.groups,
      adminGroups: identity.adminGroups,
      settingsAdmins: settings.admins,
      initialAdminEmails: config.organizations.initialAdminEmails,
      current,
    })
  }

  /** Recomputes the role of a member who already has a row and stamps the sign-in. */
  async function refresh(existing: UserRow): Promise<UserRow> {
    if (!existing.isEnabled) throw new SignInError('account_disabled')

    if (existing.organizationId !== resolvedOrganizationId) {
      // Aliases and the resolution strategy can change under a member who already has links.
      // The stored organization wins; moving them would strand everything they own.
      request.log.warn(
        {
          email,
          storedOrganizationId: existing.organizationId,
          resolvedOrganizationId,
        },
        'the resolved organization differs from the one this member already belongs to',
      )
    }

    const decision = await decide(existing.organizationId, {
      role: existing.role,
      roleSource: existing.roleSource,
    })
    const stamp = new Date(now())
    const rows = await db
      .update(users)
      .set({ ...decision, lastLoginAt: stamp, updatedAt: stamp })
      .where(eq(users.id, existing.id))
      .returning()
    return rows[0] ?? { ...existing, ...decision, lastLoginAt: stamp }
  }

  async function create(): Promise<{ row: UserRow; isFirstSignIn: boolean }> {
    const organizationId = resolvedOrganizationId
    // Spec 01 §1.3: the row appears on the first sign-in of one of its members.
    await settingsService.ensureOrganization(organizationId)

    const decision = await decide(organizationId, undefined)
    const stamp = new Date(now())
    const inserted = await db
      .insert(users)
      .values({ email, organizationId, ...decision, lastLoginAt: stamp, updatedAt: stamp })
      .onConflictDoNothing({ target: users.email })
      .returning()

    const created = inserted[0]
    if (created !== undefined) return { row: created, isFirstSignIn: true }

    // Two sign-ins for the same brand-new address raced; the other one won.
    const raced = await findUserByEmail(db, email)
    if (raced === undefined) {
      throw new SignInError('provider_error', {
        message: `The account for ${email} could not be created.`,
      })
    }
    return { row: await refresh(raced), isFirstSignIn: false }
  }

  const existing = await findUserByEmail(db, email)
  const upserted =
    existing === undefined ? await create() : { row: await refresh(existing), isFirstSignIn: false }
  const row = upserted.row

  if (upserted.isFirstSignIn) await recordUserCreated(request, row)

  await openSession(request, {
    userId: String(row.id),
    providerId: identity.providerId,
    ...(config.oidc.logoutAtIdp && identity.idToken !== undefined
      ? { idToken: identity.idToken }
      : {}),
    now,
  })

  const member = memberOf(row)
  // The role decided a moment ago is the one the next request must see, not a cached copy.
  memberCacheOf(app)?.remember(member)
  request.member = member

  return { member, isFirstSignIn: upserted.isFirstSignIn, roleSource: row.roleSource }
}

/** Writes the `user.created` event of spec 01 §2.2 through the audit recorder (spec 07 §1). */
async function recordUserCreated(request: FastifyRequest, row: UserRow): Promise<void> {
  await recordAuditEvent(request.server.db, {
    organizationId: row.organizationId,
    type: 'user.created',
    // A member's creation is caused by that member arriving, so they are their own actor.
    actorUserId: row.id,
    objectType: 'user',
    objectId: row.id,
    data: {
      email: row.email,
      role: row.role,
      roleSource: row.roleSource,
      organizationId: row.organizationId,
    },
    requestId: request.id,
  })
}

interface OpenSessionInput {
  userId: string
  providerId: string
  idToken?: string
  now: () => number
}

/** Opens the session of spec 02 §3 on a fresh id, so a fixated cookie cannot survive sign-in. */
async function openSession(request: FastifyRequest, input: OpenSessionInput): Promise<void> {
  const previous = sessionOf(request)
  if (previous === null) {
    throw new SignInError('provider_error', {
      message: 'This request has no session to sign in to.',
    })
  }

  await previous.regenerate()
  const session = sessionOf(request)
  if (session === null) {
    throw new SignInError('provider_error', { message: 'The session could not be created.' })
  }

  const stamp = new Date(input.now()).toISOString()
  session.set('userId', input.userId)
  session.set('providerId', input.providerId)
  session.set('createdAt', stamp)
  session.set('lastSeenAt', stamp)
  if (input.idToken !== undefined) session.set('idToken', input.idToken)
}

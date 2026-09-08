// Helpers the link and audit suites share.
//
// The shared `fixtures.ts` seeds rows; this file seeds the *situation* a link write happens
// in: an organization with an owner, an admin, and a bystander, the settings document the
// write is judged against, and the audit rows it left behind.

import type { Link } from '@golinks/shared/api'
import type { EnvironmentInput } from '@golinks/shared/config'
import type { EvaluatedKeyword, KeywordRules } from '@golinks/shared/keywords'
import { evaluateKeyword } from '@golinks/shared/keywords'
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '@golinks/shared/settings'
import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../../src/db/client.ts'
import { type AuditEventRow, auditEvents, type UserRow, users } from '../../src/db/schema/index.ts'
import type { LinkWriteContext } from '../../src/links/index.ts'
import type { CurrentMember, GoLinksApp } from '../../src/types.ts'
import { insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { buildIdentityApp, type SignedInSession, signIn } from './sign-in.ts'

/** One organization with the three kinds of caller spec 03 §5 distinguishes. */
export interface LinkWorld {
  organizationId: string
  owner: UserRow
  admin: UserRow
  bystander: UserRow
  ownerMember: CurrentMember
  adminMember: CurrentMember
  bystanderMember: CurrentMember
}

/** The signed-in member a user row acts as (spec 02 §5). */
export function asMember(user: UserRow): CurrentMember {
  return {
    id: String(user.id),
    email: user.email,
    organizationId: user.organizationId,
    role: user.role,
  }
}

/** Creates the organization and its three members. */
export async function seedLinkWorld(
  db: Database,
  organizationId: string = TEST_ORGANIZATION_IDS.widgets,
): Promise<LinkWorld> {
  await insertOrganization(db, organizationId)
  const owner = await insertUser(db, { email: `ada@${organizationId}`, organizationId })
  const admin = await insertUser(db, {
    email: `grace@${organizationId}`,
    organizationId,
    role: 'admin',
  })
  const bystander = await insertUser(db, { email: `linus@${organizationId}`, organizationId })

  return {
    organizationId,
    owner,
    admin,
    bystander,
    ownerMember: asMember(owner),
    adminMember: asMember(admin),
    bystanderMember: asMember(bystander),
  }
}

/** A settings document that differs from the defaults only where a test says so. */
export function testSettings(overrides: Partial<OrganizationSettings> = {}): OrganizationSettings {
  return { ...DEFAULT_ORGANIZATION_SETTINGS, ...overrides }
}

/** The same, for the `keywords` block alone (spec 06 §2). */
export function settingsWithKeywordRules(
  overrides: Partial<KeywordRules>,
  rest: Partial<OrganizationSettings> = {},
): OrganizationSettings {
  return testSettings({
    ...rest,
    keywords: { ...DEFAULT_ORGANIZATION_SETTINGS.keywords, ...overrides },
  })
}

/** What every write takes: who is asking, under which settings, on which request. */
export function writeContext(
  member: CurrentMember,
  settings: OrganizationSettings = testSettings(),
  requestId = 'req-test',
): LinkWriteContext {
  return { member, settings, requestId }
}

/**
 * Runs a keyword through the shared rules, for the conflict tests that need an evaluation
 * without going through the service. Throws when the keyword is not valid at all, which
 * would make the test's intent unclear.
 */
export function evaluateFor(
  keyword: string,
  settings: OrganizationSettings = testSettings(),
  namespace: string = settings.defaultNamespace,
): EvaluatedKeyword {
  const evaluation = evaluateKeyword(keyword, settings.keywords, {
    namespace,
    defaultNamespace: settings.defaultNamespace,
    namespaces: settings.namespaces,
  })
  if (!evaluation.ok) throw new Error(`"${keyword}" is not a valid keyword: ${evaluation.message}`)
  return evaluation
}

/** The audit trail of one organization, oldest first, optionally for one object. */
export async function readAuditEvents(
  db: Database,
  organizationId: string,
  object?: { type: 'link' | 'user' | 'organization' | 'transfer'; id: string | number },
): Promise<AuditEventRow[]> {
  const conditions = [eq(auditEvents.organizationId, organizationId)]
  if (object !== undefined) {
    conditions.push(eq(auditEvents.objectType, object.type))
    conditions.push(eq(auditEvents.objectId, String(object.id)))
  }
  return await db
    .select()
    .from(auditEvents)
    .where(and(...conditions))
    .orderBy(asc(auditEvents.id))
}

// --- the situation an HTTP test acts in -------------------------------------

/** The group a test token names when it signs a member in as an administrator. */
export const TEST_ADMIN_GROUP = 'golinks-admins'

/**
 * A silent instance with the identity foundation and the API routes, wired so that a change
 * to a member's row is seen at once: the member cache would otherwise hold a stale role for a
 * minute, which is a lifetime inside one test.
 */
export function buildLinksApp(
  database: Database,
  environment: EnvironmentInput = {},
): Promise<GoLinksApp> {
  return buildIdentityApp({ database, environment, identity: { memberCacheTtlMs: 0 } })
}

/** A signed-in member of an HTTP test: their session headers and the row behind them. */
export interface SignedInMember {
  session: SignedInSession
  user: UserRow
  member: CurrentMember
  /** Headers a read carries. */
  headers: { cookie: string }
  /** Headers a write carries: the cookie, the Origin, and the content type (spec 02 §6). */
  apiHeaders: { cookie: string; origin: string; 'content-type': string }
}

export interface SignInMemberOptions {
  email: string
  /** Signs in through a group that confers the admin role (spec 01 §2.3). */
  admin?: boolean
}

/**
 * Signs a member in through the test endpoint and reads back the row it created, so a test can
 * name ids and addresses without reaching past the HTTP surface to make members.
 */
export async function signInMember(
  app: GoLinksApp,
  db: Database,
  options: SignInMemberOptions,
): Promise<SignedInMember> {
  const session = await signIn(app, {
    email: options.email,
    ...(options.admin === true
      ? { groups: [TEST_ADMIN_GROUP], adminGroups: [TEST_ADMIN_GROUP] }
      : {}),
  })

  const rows = await db.select().from(users).where(eq(users.email, options.email)).limit(1)
  const user = rows[0]
  if (user === undefined) throw new Error(`Signing in ${options.email} created no user row.`)

  return {
    session,
    user,
    member: asMember(user),
    headers: session.headers,
    apiHeaders: session.apiHeaders,
  }
}

/** Saves a settings document for the organization, dropping the cached copy with it. */
export async function applySettings(
  app: GoLinksApp,
  organizationId: string,
  overrides: Partial<OrganizationSettings> = {},
): Promise<OrganizationSettings> {
  return await app.organizationSettings.saveSettings(organizationId, testSettings(overrides))
}

/** The error envelope of spec 05 §4, as a response carries it. */
export interface ErrorEnvelopeBody {
  error: { code: string; message: string; details?: Record<string, unknown>; existingLink?: Link }
}

/** The error code a response reported, for a test that only cares which rule refused it. */
export function errorCodeOf(response: { json: <T>() => T }): string {
  return response.json<ErrorEnvelopeBody>().error.code
}

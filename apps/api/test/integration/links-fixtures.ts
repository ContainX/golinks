// Helpers the link and audit suites share.
//
// The shared `fixtures.ts` seeds rows; this file seeds the *situation* a link write happens
// in: an organization with an owner, an admin, and a bystander, the settings document the
// write is judged against, and the audit rows it left behind.

import type { EvaluatedKeyword, KeywordRules } from '@golinks/shared/keywords'
import { evaluateKeyword } from '@golinks/shared/keywords'
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '@golinks/shared/settings'
import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '../../src/db/client.ts'
import { type AuditEventRow, auditEvents, type UserRow } from '../../src/db/schema/index.ts'
import type { LinkWriteContext } from '../../src/links/index.ts'
import type { CurrentMember } from '../../src/types.ts'
import { insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'

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

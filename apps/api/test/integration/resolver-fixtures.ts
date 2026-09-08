// The organization of spec 04 §9, in a real database.
//
// The worked examples are written against one organization with one extra namespace and five
// links, and the resolver suites read them back through `app.inject()`. Only the shape of the
// keyword columns changes between the punctuation-sensitive and punctuation-insensitive runs,
// which is exactly what the examples are there to pin down.

import { canonicalizeKeyword, type KeywordRules } from '@golinks/shared/keywords'
import {
  type OrganizationSettings,
  type OrganizationSettingsInput,
  OrganizationSettingsSchema,
} from '@golinks/shared/settings'
import { eq } from 'drizzle-orm'
import type { Database } from '../../src/db/client.ts'
import { organizations } from '../../src/db/schema/index.ts'
import type { CurrentMember } from '../../src/types.ts'
import { insertLink, insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'

/** The organization the worked examples resolve in. */
export const RESOLVER_ORGANIZATION = TEST_ORGANIZATION_IDS.widgets

/** A second organization, so every suite can prove that nothing crosses (spec 03 §4). */
export const OTHER_ORGANIZATION = TEST_ORGANIZATION_IDS.gizmos

export const RESOLVER_MEMBER_EMAIL = 'ada@widgets.test'

/** The extra namespace of spec 04 §9. */
export const EXTRA_NAMESPACE = 'eng'

/** One link as spec 04 §9 lists it, before canonicalization. */
export interface ExampleLink {
  namespace?: string
  /** The keyword as it is written in the examples table. */
  keyword: string
  destination: string
}

export const EXAMPLE_LINKS: readonly ExampleLink[] = [
  { keyword: 'handbook', destination: 'https://wiki.acme.com/handbook' },
  { keyword: 'jira/%s', destination: 'https://acme.atlassian.net/browse/%s' },
  { keyword: 'gh/%s/%s', destination: 'https://github.com/acme/%s/issues/%s' },
  { keyword: 'meeting-notes', destination: 'https://docs.acme.com/notes' },
  { namespace: EXTRA_NAMESPACE, keyword: 'deploy', destination: 'https://deploy.acme.com' },
]

/**
 * The canonical form a keyword is stored under (spec 03 §2.2), which is what the unique index
 * and every lookup use. In a punctuation-sensitive organization it equals the keyword as
 * written; otherwise punctuation is dropped from each segment.
 */
export function canonicalFormOf(keyword: string, rules: KeywordRules): string {
  const canonical = canonicalizeKeyword(keyword, rules)
  if (!canonical.ok) throw new Error(`"${keyword}" has no canonical form: ${canonical.message}`)
  return canonical.canonicalKeyword
}

export interface SeedOptions {
  /** Overrides on top of the settings the examples assume. */
  settings?: OrganizationSettingsInput
  links?: readonly ExampleLink[]
}

export interface SeededOrganization {
  settings: OrganizationSettings
  member: CurrentMember
  /** Keyword as written in the examples, mapped to the row id it was stored as. */
  linkIds: Map<string, number>
}

/** Replaces an organization's settings document without going through the settings service. */
export async function writeSettings(
  db: Database,
  organizationId: string,
  input: OrganizationSettingsInput,
): Promise<OrganizationSettings> {
  const settings = OrganizationSettingsSchema.parse(input)
  await db
    .update(organizations)
    .set({ settings, updatedAt: new Date() })
    .where(eq(organizations.id, organizationId))
  return settings
}

/**
 * Creates the organization, its member, and the example links, storing each keyword in the
 * canonical form the organization's punctuation rule produces.
 */
export async function seedExampleOrganization(
  db: Database,
  options: SeedOptions = {},
): Promise<SeededOrganization> {
  await insertOrganization(db, RESOLVER_ORGANIZATION)
  const settings = await writeSettings(db, RESOLVER_ORGANIZATION, {
    namespaces: [EXTRA_NAMESPACE],
    ...options.settings,
  })

  const user = await insertUser(db, {
    email: RESOLVER_MEMBER_EMAIL,
    organizationId: RESOLVER_ORGANIZATION,
  })

  const linkIds = new Map<string, number>()
  for (const example of options.links ?? EXAMPLE_LINKS) {
    const row = await insertLink(db, {
      organizationId: RESOLVER_ORGANIZATION,
      ownerId: user.id,
      namespace: example.namespace ?? settings.defaultNamespace,
      keyword: canonicalFormOf(example.keyword, settings.keywords),
      displayKeyword: example.keyword,
      destination: example.destination,
    })
    linkIds.set(example.keyword, row.id)
  }

  return {
    settings,
    member: {
      id: String(user.id),
      email: user.email,
      organizationId: user.organizationId,
      role: user.role,
    },
    linkIds,
  }
}

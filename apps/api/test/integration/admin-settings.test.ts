// `GET /_/api/v1/admin/settings` and `PUT /_/api/v1/admin/settings` (spec 06 §2-3, spec 05 §3).
//
// The interesting half of this suite is what a settings change does to the links it governs:
// keywords recomputed, a namespace renamed, and every rule that stops a change from leaving
// links ambiguous or unreachable.

import { AdminSettingsResponseSchema, API_BASE_PATH } from '@golinks/shared/api'
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type KeywordRules,
  type OrganizationSettings,
} from '@golinks/shared/settings'
import { and, asc, eq } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../src/db/client.ts'
import {
  type AuditEventRow,
  auditEvents,
  type LinkRow,
  links,
  type UserRow,
  users,
} from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertLink, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { buildIdentityApp, type SignedInSession, signIn } from './sign-in.ts'

const database = useTestDatabase()
const SETTINGS_URL = `${API_BASE_PATH}/admin/settings`
const WIDGETS = TEST_ORGANIZATION_IDS.widgets
const ADMIN_GROUP = 'golinks-admins'
const ADMIN_EMAIL = `grace@${WIDGETS}`
const MEMBER_EMAIL = `ada@${WIDGETS}`

let app: GoLinksApp | undefined

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** An instance whose member cache never hides a change made a moment ago. */
async function buildAdminApp(): Promise<GoLinksApp> {
  app = await buildIdentityApp({ database: database().db, identity: { memberCacheTtlMs: 0 } })
  return app
}

/** Signs in through a group that confers the admin role (spec 01 §2.3). */
function signInAdmin(instance: GoLinksApp, email = ADMIN_EMAIL): Promise<SignedInSession> {
  return signIn(instance, { email, groups: [ADMIN_GROUP], adminGroups: [ADMIN_GROUP] })
}

async function readUser(db: Database, email: string): Promise<UserRow> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const row = rows[0]
  if (row === undefined) throw new Error(`No user row for ${email}.`)
  return row
}

/** A settings document that differs from the defaults only where a test says so. */
type SettingsOverrides = Partial<Omit<OrganizationSettings, 'keywords'>> & {
  keywords?: Partial<KeywordRules>
}

function document(overrides: SettingsOverrides = {}): OrganizationSettings {
  return {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    ...overrides,
    keywords: { ...DEFAULT_ORGANIZATION_SETTINGS.keywords, ...overrides.keywords },
  }
}

function putSettings(
  instance: GoLinksApp,
  session: SignedInSession,
  body: object,
): Promise<LightMyRequestResponse> {
  return instance.inject({
    method: 'PUT',
    url: SETTINGS_URL,
    headers: session.apiHeaders,
    payload: body,
  })
}

async function organizationLinks(db: Database, organizationId: string): Promise<LinkRow[]> {
  return await db
    .select()
    .from(links)
    .where(eq(links.organizationId, organizationId))
    .orderBy(asc(links.id))
}

async function settingsEvents(db: Database, organizationId: string): Promise<AuditEventRow[]> {
  return await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.organizationId, organizationId),
        eq(auditEvents.type, 'organization.settings_updated'),
      ),
    )
    .orderBy(asc(auditEvents.id))
}

describe('GET /admin/settings', () => {
  it('answers with the whole document, admin list included', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await instance.organizationSettings.saveSettings(WIDGETS, document({ admins: ['boss@x.test'] }))

    const response = await instance.inject({
      method: 'GET',
      url: SETTINGS_URL,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    const body = AdminSettingsResponseSchema.parse(response.json())
    expect(body.admins).toEqual(['boss@x.test'])
    expect(body.defaultNamespace).toBe('go')
  })

  it('refuses a caller with no session', async () => {
    const instance = await buildAdminApp()

    const response = await instance.inject({ method: 'GET', url: SETTINGS_URL })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('unauthenticated')
  })

  it('refuses a member who does not administer the organization', async () => {
    const instance = await buildAdminApp()
    const session = await signIn(instance, { email: MEMBER_EMAIL })

    const response = await instance.inject({
      method: 'GET',
      url: SETTINGS_URL,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('forbidden')
  })
})

describe('PUT /admin/settings', () => {
  it('stores the document and hands the stored one back', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await putSettings(
      instance,
      session,
      document({
        namespaces: ['eng'],
        readOnly: true,
        banner: { text: 'Migration on Friday', url: null, level: 'warning' },
      }),
    )

    expect(response.statusCode).toBe(200)
    const body = AdminSettingsResponseSchema.parse(response.json())
    expect(body.namespaces).toEqual(['eng'])
    expect(body.readOnly).toBe(true)
    // Spec 06 §4: the replica that wrote reads the change at once.
    const stored = await instance.organizationSettings.getSettings(WIDGETS)
    expect(stored.banner?.text).toBe('Migration on Friday')
  })

  it('fills the fields an admin left out with their defaults', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await putSettings(instance, session, { defaultNamespace: 'links' })

    expect(response.statusCode).toBe(200)
    const body = AdminSettingsResponseSchema.parse(response.json())
    expect(body.defaultNamespace).toBe('links')
    expect(body.keywords).toEqual(DEFAULT_ORGANIZATION_SETTINGS.keywords)
    expect(body.branding.title).toBe(DEFAULT_ORGANIZATION_SETTINGS.branding.title)
  })

  it('records organization.settings_updated with the fields that moved', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)

    await putSettings(instance, session, document({ readOnly: true }))

    const events = await settingsEvents(database().db, WIDGETS)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ objectType: 'organization', objectId: WIDGETS })
    expect(events[0]?.actorUserId).toBe(admin.id)
    expect(events[0]?.data).toEqual({ changes: { readOnly: [false, true] } })
  })

  it('records nothing when the document that arrived is the one already stored', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    await putSettings(instance, session, document())

    expect(await settingsEvents(database().db, WIDGETS)).toEqual([])
  })

  it('rejects a document with an unknown field', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await putSettings(instance, session, { ...document(), theme: 'dark' })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('rejects a namespace name the schema does not accept, naming the field', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await putSettings(instance, session, document({ namespaces: ['Engineering'] }))

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body.error.code).toBe('validation_failed')
    expect(Object.keys(body.error.details.fields)).toContain('namespaces.0')
  })

  it('rejects a namespace that repeats the default one', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await putSettings(instance, session, document({ namespaces: ['go'] }))

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('rejects an allowed pattern that is not a regular expression', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await putSettings(
      instance,
      session,
      document({ keywords: { allowedPattern: '^[a-z' } }),
    )

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('refuses a caller with no session', async () => {
    const instance = await buildAdminApp()

    const response = await instance.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: { origin: instance.appConfig.baseUrl, 'content-type': 'application/json' },
      payload: document(),
    })

    expect(response.statusCode).toBe(401)
  })

  it('refuses a member who does not administer the organization', async () => {
    const instance = await buildAdminApp()
    const session = await signIn(instance, { email: MEMBER_EMAIL })

    const response = await putSettings(instance, session, document({ readOnly: true }))

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('forbidden')
  })
})

describe('PUT /admin/settings: namespaces (spec 03 §2.5, spec 06 §2)', () => {
  it('refuses a namespace an existing keyword already uses as its first segment', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      keyword: 'eng/deploy',
    })

    const response = await putSettings(instance, session, document({ namespaces: ['eng'] }))

    expect(response.statusCode).toBe(409)
    const body = response.json()
    expect(body.error.code).toBe('namespace_conflicts')
    expect(body.error.details.conflicts[0].namespace).toBe('eng')
    expect(body.error.details.conflicts[0].links[0].fullPath).toBe('go/eng/deploy')
    // Nothing was stored: the document is still the one the organization started with.
    expect((await instance.organizationSettings.getSettings(WIDGETS)).namespaces).toEqual([])
  })

  it('allows a namespace whose name is only a single-segment keyword', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await insertLink(database().db, { organizationId: WIDGETS, ownerId: admin.id, keyword: 'eng' })

    const response = await putSettings(instance, session, document({ namespaces: ['eng'] }))

    expect(response.statusCode).toBe(200)
  })

  it('refuses to remove a namespace that still holds links, with the count', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await instance.organizationSettings.saveSettings(WIDGETS, document({ namespaces: ['eng'] }))
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      namespace: 'eng',
      keyword: 'deploy',
    })
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      namespace: 'eng',
      keyword: 'runbook',
    })

    const response = await putSettings(instance, session, document({ namespaces: [] }))

    expect(response.statusCode).toBe(409)
    const body = response.json()
    expect(body.error.code).toBe('namespace_in_use')
    expect(body.error.details.namespaces).toEqual([{ namespace: 'eng', linkCount: 2 }])
  })

  it('lets an empty namespace go', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await instance.organizationSettings.saveSettings(WIDGETS, document({ namespaces: ['eng'] }))

    const response = await putSettings(instance, session, document({ namespaces: [] }))

    expect(response.statusCode).toBe(200)
    expect((await instance.organizationSettings.getSettings(WIDGETS)).namespaces).toEqual([])
  })
})

describe('PUT /admin/settings: punctuation sensitivity (spec 06 §2)', () => {
  it('recomputes every canonical keyword and keeps the links resolving', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      keyword: 'meeting-notes',
      destination: 'https://docs.widgets.test/notes',
    })

    const response = await putSettings(
      instance,
      session,
      document({ keywords: { punctuationSensitive: false } }),
    )

    expect(response.statusCode).toBe(200)
    const [stored] = await organizationLinks(database().db, WIDGETS)
    expect(stored).toMatchObject({
      keyword: 'meetingnotes',
      displayKeyword: 'meeting-notes',
      keywordPrefix: 'meetingnotes',
    })

    // Spec 04 §5.1: both spellings now reach the same link.
    for (const path of ['/meetingnotes', '/meeting-notes']) {
      const redirect = await instance.inject({ method: 'GET', url: path, headers: session.headers })
      expect(redirect.statusCode).toBe(302)
      expect(redirect.headers.location).toBe('https://docs.widgets.test/notes')
    }
  })

  it('puts the canonical keyword back to the display keyword when the rule returns', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await instance.organizationSettings.saveSettings(
      WIDGETS,
      document({ keywords: { punctuationSensitive: false } }),
    )
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      keyword: 'meetingnotes',
      displayKeyword: 'meeting-notes',
    })

    const response = await putSettings(
      instance,
      session,
      document({ keywords: { punctuationSensitive: true } }),
    )

    expect(response.statusCode).toBe(200)
    const [stored] = await organizationLinks(database().db, WIDGETS)
    expect(stored).toMatchObject({ keyword: 'meeting-notes', keywordPrefix: 'meeting-notes' })
  })

  it('refuses the change when two keywords would collapse into one', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    for (const keyword of ['meeting-notes', 'meetingnotes']) {
      await insertLink(database().db, { organizationId: WIDGETS, ownerId: admin.id, keyword })
    }

    const response = await putSettings(
      instance,
      session,
      document({ keywords: { punctuationSensitive: false } }),
    )

    expect(response.statusCode).toBe(409)
    const body = response.json()
    expect(body.error.code).toBe('keyword_conflict')
    expect(body.error.details.collisions[0].keyword).toBe('meetingnotes')
    expect(
      body.error.details.collisions[0].links.map((l: { fullPath: string }) => l.fullPath),
    ).toEqual(['go/meeting-notes', 'go/meetingnotes'])

    // The transaction rolled back: both links keep the keywords they had.
    const stored = await organizationLinks(database().db, WIDGETS)
    expect(stored.map((row) => row.keyword)).toEqual(['meeting-notes', 'meetingnotes'])
    expect(
      (await instance.organizationSettings.getSettings(WIDGETS)).keywords.punctuationSensitive,
    ).toBe(true)
  })
})

describe('PUT /admin/settings: resolution mode (spec 06 §2)', () => {
  it('accepts prefix fallback when every keyword already satisfies it', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    for (const keyword of ['handbook', 'jira/%s']) {
      await insertLink(database().db, { organizationId: WIDGETS, ownerId: admin.id, keyword })
    }

    const response = await putSettings(
      instance,
      session,
      document({ keywords: { resolutionMode: 'prefixFallback' } }),
    )

    expect(response.statusCode).toBe(200)
  })

  it('refuses prefix fallback while a hierarchical keyword exists (spec 03 §2.4)', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      keyword: 'docs/api',
    })

    const response = await putSettings(
      instance,
      session,
      document({ keywords: { resolutionMode: 'prefixFallback' } }),
    )

    expect(response.statusCode).toBe(409)
    const body = response.json()
    expect(body.error.code).toBe('keyword_conflict')
    expect(body.error.details.placeholderViolations[0].fullPath).toBe('go/docs/api')
  })

  it('refuses prefix fallback while a keyword and a pattern share a segment (spec 03 §6.1)', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    for (const keyword of ['example', 'example/%s']) {
      await insertLink(database().db, { organizationId: WIDGETS, ownerId: admin.id, keyword })
    }

    const response = await putSettings(
      instance,
      session,
      document({ keywords: { resolutionMode: 'prefixFallback' } }),
    )

    expect(response.statusCode).toBe(409)
    const body = response.json()
    expect(body.error.code).toBe('keyword_conflict')
    expect(body.error.details.prefixConflicts[0].prefix).toBe('example')
  })
})

describe('PUT /admin/settings: the default namespace (spec 06 §3)', () => {
  it('rewrites the links and leaves them resolving under the new name', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await instance.organizationSettings.saveSettings(WIDGETS, document({ namespaces: ['eng'] }))
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      keyword: 'handbook',
      destination: 'https://wiki.widgets.test/handbook',
    })
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      namespace: 'eng',
      keyword: 'deploy',
      destination: 'https://deploy.widgets.test',
    })

    const response = await putSettings(
      instance,
      session,
      document({ defaultNamespace: 'links', namespaces: ['eng'] }),
    )

    expect(response.statusCode).toBe(200)
    const stored = await organizationLinks(database().db, WIDGETS)
    expect(stored.map((row) => [row.namespace, row.keyword])).toEqual([
      ['links', 'handbook'],
      ['eng', 'deploy'],
    ])

    const redirect = await instance.inject({
      method: 'GET',
      url: '/handbook',
      headers: session.headers,
    })
    expect(redirect.statusCode).toBe(302)
    expect(redirect.headers.location).toBe('https://wiki.widgets.test/handbook')

    // The named namespace is untouched by the move.
    const named = await instance.inject({
      method: 'GET',
      url: '/eng/deploy',
      headers: session.headers,
    })
    expect(named.headers.location).toBe('https://deploy.widgets.test/')
  })

  it('records the move in the audit trail', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    await putSettings(instance, session, document({ defaultNamespace: 'links' }))

    const events = await settingsEvents(database().db, WIDGETS)
    expect(events[0]?.data).toEqual({ changes: { defaultNamespace: ['go', 'links'] } })
  })

  it('refuses to move onto a namespace that still holds links', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await instance.organizationSettings.saveSettings(WIDGETS, document({ namespaces: ['eng'] }))
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: admin.id,
      namespace: 'eng',
      keyword: 'deploy',
    })

    const response = await putSettings(
      instance,
      session,
      document({ defaultNamespace: 'eng', namespaces: [] }),
    )

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('namespace_in_use')
  })

  it('leaves the links of another organization where they are', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const elsewhere = await signIn(instance, { email: 'someone@gizmos.test' })
    expect(elsewhere.cookie).not.toBe('')
    const neighbour = await readUser(database().db, 'someone@gizmos.test')
    await insertLink(database().db, {
      organizationId: TEST_ORGANIZATION_IDS.gizmos,
      ownerId: neighbour.id,
      keyword: 'handbook',
    })

    await putSettings(instance, session, document({ defaultNamespace: 'links' }))

    const theirs = await organizationLinks(database().db, TEST_ORGANIZATION_IDS.gizmos)
    expect(theirs.map((row) => row.namespace)).toEqual(['go'])
  })
})

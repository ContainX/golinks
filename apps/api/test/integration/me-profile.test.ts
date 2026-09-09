// `GET /_/api/v1/me` and `PATCH /_/api/v1/me` (spec 05 §2.2, spec 01 §2.5).

import { API_BASE_PATH, MeSchema } from '@golinks/shared/api'
import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { organizations, users } from '../../src/db/schema/index.ts'
import { SERVICE_VERSION } from '../../src/routes/me.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { buildIdentityApp, signIn, TEST_BASE_URL, TEST_MEMBER_EMAIL } from './sign-in.ts'

const database = useTestDatabase()
const ME_URL = `${API_BASE_PATH}/me`
const WIDGETS = TEST_ORGANIZATION_IDS.widgets

let app: GoLinksApp | undefined

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('GET /me', () => {
  it('answers with the shape the shared schema defines', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const response = await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })

    expect(response.statusCode).toBe(200)
    const parsed = MeSchema.safeParse(response.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it('names the member, their organization, and the deployment', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const body = MeSchema.parse(
      (await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })).json(),
    )

    expect(body.user).toMatchObject({
      email: TEST_MEMBER_EMAIL,
      organizationId: WIDGETS,
      role: 'member',
      preferences: {},
    })
    expect(body.organization).toMatchObject({
      id: WIDGETS,
      defaultNamespace: DEFAULT_ORGANIZATION_SETTINGS.defaultNamespace,
      namespaces: [],
      keywords: DEFAULT_ORGANIZATION_SETTINGS.keywords,
      readOnly: false,
      banner: null,
    })
    expect(body.app).toEqual({
      baseUrl: TEST_BASE_URL,
      shortHost: 'go',
      version: SERVICE_VERSION,
      // This deployment fixes no settings of its own (spec 06 §6).
      managedSettings: [],
    })
    expect(SERVICE_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('never hands a member the organization admin list', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)
    await database()
      .db.update(organizations)
      .set({ settings: { ...DEFAULT_ORGANIZATION_SETTINGS, admins: ['boss@widgets.test'] } })
      .where(eq(organizations.id, WIDGETS))
    app.organizationSettings.invalidate(WIDGETS)

    const body = (await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })).json<
      Record<string, Record<string, unknown>>
    >()

    expect(body.organization).not.toHaveProperty('admins')
  })

  it('reflects the organization settings an admin has saved', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)
    await app.organizationSettings.saveSettings(WIDGETS, {
      ...DEFAULT_ORGANIZATION_SETTINGS,
      namespaces: ['eng'],
      readOnly: true,
      banner: { text: 'Maintenance on Friday', url: null, level: 'warning' },
    })

    const body = MeSchema.parse(
      (await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })).json(),
    )

    expect(body.organization.namespaces).toEqual(['eng'])
    expect(body.organization.readOnly).toBe(true)
    expect(body.organization.banner).toMatchObject({ text: 'Maintenance on Friday' })
  })

  it('refuses a caller with no session', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await app.inject({ method: 'GET', url: ME_URL })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('unauthenticated')
  })
})

describe('PATCH /me', () => {
  it('stores the whitelisted preference keys and answers with the new profile', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const response = await app.inject({
      method: 'PATCH',
      url: ME_URL,
      headers: session.apiHeaders,
      payload: { preferences: { dismissedNotices: ['short-host-setup'] } },
    })

    expect(response.statusCode).toBe(200)
    expect(MeSchema.parse(response.json()).user.preferences).toEqual({
      dismissedNotices: ['short-host-setup'],
    })

    const rows = await database().db.select().from(users).where(eq(users.email, TEST_MEMBER_EMAIL))
    expect(rows[0]?.preferences).toEqual({ dismissedNotices: ['short-host-setup'] })
  })

  it('replaces the document, so an empty object clears what was there', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    await app.inject({
      method: 'PATCH',
      url: ME_URL,
      headers: session.apiHeaders,
      payload: { preferences: { dismissedNotices: ['short-host-setup'] } },
    })
    const cleared = await app.inject({
      method: 'PATCH',
      url: ME_URL,
      headers: session.apiHeaders,
      payload: { preferences: {} },
    })

    expect(MeSchema.parse(cleared.json()).user.preferences).toEqual({})
  })

  it('rejects an unknown preference key (spec 01 §2.5)', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const response = await app.inject({
      method: 'PATCH',
      url: ME_URL,
      headers: session.apiHeaders,
      payload: { preferences: { theme: 'dark' } },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('rejects an unknown field beside the preferences', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const response = await app.inject({
      method: 'PATCH',
      url: ME_URL,
      headers: session.apiHeaders,
      payload: { preferences: {}, role: 'admin' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('refuses a caller with no session', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await app.inject({
      method: 'PATCH',
      url: ME_URL,
      headers: { origin: TEST_BASE_URL, 'content-type': 'application/json' },
      payload: { preferences: {} },
    })

    expect(response.statusCode).toBe(401)
  })

  it('refuses a request from another origin (spec 02 §6)', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const response = await app.inject({
      method: 'PATCH',
      url: ME_URL,
      headers: { ...session.apiHeaders, origin: 'https://evil.test' },
      payload: { preferences: {} },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('csrf_origin_mismatch')
  })
})

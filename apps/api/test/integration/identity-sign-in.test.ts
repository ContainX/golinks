// Completing a sign-in against a real database (spec 01 §§1.2, 2.2-2.4, spec 02 §2).

import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SignInError } from '../../src/auth/errors.ts'
import { createIdentityPlugin } from '../../src/auth/plugin.ts'
import { completeSignIn, type SignInOutcome } from '../../src/auth/sign-in.ts'
import { auditEvents, organizations, users } from '../../src/db/schema/index.ts'
import { buildTestApp } from '../../src/testing/fixtures.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { testAuthEnvironment } from './sign-in.ts'

const database = useTestDatabase()
const WIDGETS = TEST_ORGANIZATION_IDS.widgets

/** A route that hands the sign-in an identity, standing in for the OIDC callback. */
const SIGN_IN_URL = '/_/test/complete-sign-in'

interface SignInRequest {
  email: unknown
  providerId?: string
  groups?: string[]
  adminGroups?: string[]
  emailVerified?: unknown
  idToken?: string
}

let app: GoLinksApp | undefined

async function buildSignInApp(environment: Record<string, string> = {}): Promise<GoLinksApp> {
  const { db } = database()
  return buildTestApp({
    environment: testAuthEnvironment(environment),
    database: db,
    plugins: [
      createIdentityPlugin(),
      (instance) => {
        instance.route({
          method: 'POST',
          url: SIGN_IN_URL,
          handler: async (request, reply) => {
            const identity = request.body as SignInRequest
            try {
              const outcome = await completeSignIn(request, {
                email: identity.email,
                providerId: identity.providerId ?? 'okta',
                groups: identity.groups,
                adminGroups: identity.adminGroups,
                emailVerified: identity.emailVerified,
                idToken: identity.idToken,
              })
              return reply.send(outcome)
            } catch (error) {
              if (error instanceof SignInError) {
                return reply.code(400).send({ signInError: error.code })
              }
              throw error
            }
          },
        })
      },
    ],
  })
}

async function signInAs(identity: SignInRequest): Promise<{
  outcome?: SignInOutcome
  signInError?: string
  setCookie: string | string[] | undefined
}> {
  const instance = app
  if (instance === undefined) throw new Error('The app was not built.')

  const response = await instance.inject({
    method: 'POST',
    url: SIGN_IN_URL,
    payload: identity,
  })
  const body = response.json<Record<string, unknown>>()
  if (typeof body.signInError === 'string') {
    return { signInError: body.signInError, setCookie: response.headers['set-cookie'] }
  }
  return { outcome: body as unknown as SignInOutcome, setCookie: response.headers['set-cookie'] }
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('the first sign-in of a member', () => {
  it('creates the organization with default settings and the member with it', async () => {
    app = await buildSignInApp()

    const { outcome } = await signInAs({ email: '  Ada@Widgets.TEST  ' })

    expect(outcome?.isFirstSignIn).toBe(true)
    expect(outcome?.member).toMatchObject({
      email: 'ada@widgets.test',
      organizationId: WIDGETS,
      role: 'member',
    })

    const { db } = database()
    const organizationRows = await db.select().from(organizations)
    expect(organizationRows).toHaveLength(1)
    expect(organizationRows[0]?.id).toBe(WIDGETS)
    expect(organizationRows[0]?.settings).toEqual(DEFAULT_ORGANIZATION_SETTINGS)

    const userRows = await db.select().from(users)
    expect(userRows).toHaveLength(1)
    expect(userRows[0]).toMatchObject({ email: 'ada@widgets.test', isEnabled: true })
    expect(userRows[0]?.lastLoginAt).toBeInstanceOf(Date)
  })

  it('writes a user.created audit event naming the new member', async () => {
    app = await buildSignInApp()

    const { outcome } = await signInAs({ email: 'ada@widgets.test' })

    const rows = await database().db.select().from(auditEvents)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      organizationId: WIDGETS,
      type: 'user.created',
      objectType: 'user',
      objectId: outcome?.member.id,
      actorUserId: Number(outcome?.member.id),
    })
    expect(rows[0]?.data).toMatchObject({ email: 'ada@widgets.test', role: 'member' })
    expect(rows[0]?.requestId).toEqual(expect.any(String))
  })

  it('opens a session and sets the cookie', async () => {
    app = await buildSignInApp()

    const { setCookie } = await signInAs({ email: 'ada@widgets.test' })
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie

    expect(header).toMatch(/^gl_session=/)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Lax')
  })

  it('emits no second event when the same member signs in again', async () => {
    app = await buildSignInApp()

    await signInAs({ email: 'ada@widgets.test' })
    const second = await signInAs({ email: 'ada@widgets.test' })

    expect(second.outcome?.isFirstSignIn).toBe(false)
    await expect(database().db.select().from(auditEvents)).resolves.toHaveLength(1)
  })

  it('keeps a member in the organization their row already names', async () => {
    const { db } = database()
    await insertOrganization(db, WIDGETS)
    await insertUser(db, { email: 'ada@widgets.test', organizationId: WIDGETS })

    app = await buildSignInApp({ ORG_RESOLUTION: 'fixed', ORG_FIXED_ID: 'everyone' })
    const { outcome } = await signInAs({ email: 'ada@widgets.test' })

    expect(outcome?.member.organizationId).toBe(WIDGETS)
  })

  it('puts every member in one organization under the fixed strategy', async () => {
    app = await buildSignInApp({ ORG_RESOLUTION: 'fixed', ORG_FIXED_ID: 'Acme' })

    const first = await signInAs({ email: 'ada@widgets.test' })
    const second = await signInAs({ email: 'grace@gizmos.test' })

    expect(first.outcome?.member.organizationId).toBe('acme')
    expect(second.outcome?.member.organizationId).toBe('acme')
  })

  it('applies a domain alias before the organization is created', async () => {
    app = await buildSignInApp({ ORG_DOMAIN_ALIASES: 'gizmos.test=widgets.test' })

    const { outcome } = await signInAs({ email: 'grace@gizmos.test' })

    expect(outcome?.member.organizationId).toBe(WIDGETS)
  })
})

describe('refusing a sign-in', () => {
  it('refuses an organization outside ORG_ALLOWED_IDS and creates nothing', async () => {
    app = await buildSignInApp({ ORG_ALLOWED_IDS: 'widgets.test' })

    const { signInError } = await signInAs({ email: 'grace@gizmos.test' })

    expect(signInError).toBe('org_not_allowed')
    await expect(database().db.select().from(organizations)).resolves.toHaveLength(0)
    await expect(database().db.select().from(users)).resolves.toHaveLength(0)
  })

  it('refuses a disabled member (spec 01 §2.4)', async () => {
    const { db } = database()
    await insertOrganization(db, WIDGETS)
    await insertUser(db, { email: 'ada@widgets.test', organizationId: WIDGETS, isEnabled: false })

    app = await buildSignInApp()
    const { signInError, setCookie } = await signInAs({ email: 'ada@widgets.test' })

    expect(signInError).toBe('account_disabled')
    expect(setCookie).toBeUndefined()
  })

  it('refuses an address the provider did not return', async () => {
    app = await buildSignInApp()

    await expect(signInAs({ email: null })).resolves.toMatchObject({
      signInError: 'email_missing',
    })
    await expect(signInAs({ email: 'not-an-address' })).resolves.toMatchObject({
      signInError: 'email_missing',
    })
  })

  it('refuses an address the provider says is not verified', async () => {
    app = await buildSignInApp()

    await expect(
      signInAs({ email: 'ada@widgets.test', emailVerified: false }),
    ).resolves.toMatchObject({ signInError: 'email_unverified' })
    await expect(
      signInAs({ email: 'ada@widgets.test', emailVerified: 'no' }),
    ).resolves.toMatchObject({ signInError: 'email_unverified' })
  })

  it('accepts an address with no verification claim at all', async () => {
    app = await buildSignInApp()

    const { outcome } = await signInAs({ email: 'ada@widgets.test', emailVerified: true })
    expect(outcome?.member.email).toBe('ada@widgets.test')
  })
})

describe('the role a sign-in leaves behind', () => {
  async function roleOf(identity: SignInRequest): Promise<{ role: string; roleSource: string }> {
    const { outcome } = await signInAs(identity)
    const rows = await database()
      .db.select()
      .from(users)
      .where(eq(users.id, Number(outcome?.member.id)))
    const row = rows[0]
    if (row === undefined) throw new Error('The member was not stored.')
    return { role: row.role, roleSource: row.roleSource }
  }

  it('promotes an address in INITIAL_ADMIN_EMAILS', async () => {
    app = await buildSignInApp({ INITIAL_ADMIN_EMAILS: 'ada@widgets.test' })

    await expect(roleOf({ email: 'ada@widgets.test' })).resolves.toEqual({
      role: 'admin',
      roleSource: 'config',
    })
  })

  it('promotes an address in the organization settings', async () => {
    const { db } = database()
    await insertOrganization(db, WIDGETS)
    await db
      .update(organizations)
      .set({ settings: { ...DEFAULT_ORGANIZATION_SETTINGS, admins: ['ada@widgets.test'] } })
      .where(eq(organizations.id, WIDGETS))

    app = await buildSignInApp()

    await expect(roleOf({ email: 'ada@widgets.test' })).resolves.toEqual({
      role: 'admin',
      roleSource: 'config',
    })
  })

  it('promotes a member of a group the provider names as an admin group', async () => {
    app = await buildSignInApp()

    await expect(
      roleOf({
        email: 'ada@widgets.test',
        groups: ['engineering', 'golinks-admins'],
        adminGroups: ['golinks-admins'],
      }),
    ).resolves.toEqual({ role: 'admin', roleSource: 'idp' })
  })

  it('reads admin groups from OIDC_ADMIN_GROUPS when the caller passes none', async () => {
    app = await buildSignInApp({ OIDC_ADMIN_GROUPS: 'golinks-admins' })

    const { outcome } = await signInAs({
      email: 'ada@widgets.test',
      groups: ['golinks-admins'],
      adminGroups: ['golinks-admins'],
    })
    expect(outcome?.member.role).toBe('admin')
  })

  it('demotes an admin who is no longer listed anywhere', async () => {
    app = await buildSignInApp({ INITIAL_ADMIN_EMAILS: 'ada@widgets.test' })
    await signInAs({ email: 'ada@widgets.test' })
    await app.close()

    app = await buildSignInApp()
    await expect(roleOf({ email: 'ada@widgets.test' })).resolves.toEqual({
      role: 'member',
      roleSource: 'config',
    })
  })

  it('leaves a manually set role alone whatever the other sources say', async () => {
    const { db } = database()
    await insertOrganization(db, WIDGETS)
    const member = await insertUser(db, { email: 'ada@widgets.test', organizationId: WIDGETS })
    await db
      .update(users)
      .set({ role: 'admin', roleSource: 'manual' })
      .where(eq(users.id, member.id))

    app = await buildSignInApp()

    await expect(roleOf({ email: 'ada@widgets.test' })).resolves.toEqual({
      role: 'admin',
      roleSource: 'manual',
    })
  })

  it('leaves a manual demotion in place even for a configured admin', async () => {
    const { db } = database()
    await insertOrganization(db, WIDGETS)
    const member = await insertUser(db, {
      email: 'ada@widgets.test',
      organizationId: WIDGETS,
      role: 'admin',
    })
    await db
      .update(users)
      .set({ role: 'member', roleSource: 'manual' })
      .where(eq(users.id, member.id))

    app = await buildSignInApp({ INITIAL_ADMIN_EMAILS: 'ada@widgets.test' })

    await expect(roleOf({ email: 'ada@widgets.test' })).resolves.toEqual({
      role: 'member',
      roleSource: 'manual',
    })
  })
})

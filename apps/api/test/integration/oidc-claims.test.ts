// What the service believes about a member, and which source it believes it from
// (spec 02 §2 steps 5 to 7, spec 10 §2).
//
// A provider says who signed in twice — in the ID token and at the userinfo endpoint — and the
// two do not have to agree. These are the combinations that decide an address, its
// verification, and the groups that make an admin.

import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { type UserRow, users } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { driveSignIn, type MockOidcProvider, startMockOidcProvider } from './mock-oidc-provider.ts'
import { buildIdentityApp } from './sign-in.ts'

const database = useTestDatabase()
const ADMIN_GROUP = 'GoLinks Admins'

let provider: MockOidcProvider
let app: GoLinksApp | undefined

function buildOidcApp(overrides: Record<string, string> = {}): Promise<GoLinksApp> {
  return buildIdentityApp({
    database: database().db,
    environment: {
      AUTH_TEST_MODE: 'false',
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: provider.clientId,
      OIDC_CLIENT_SECRET: provider.clientSecret,
      OIDC_SCOPES: 'openid email profile groups',
      OIDC_ADMIN_GROUPS: ADMIN_GROUP,
      ...overrides,
    },
  })
}

/** The row a sign-in left behind, or undefined when it left none. */
async function memberRow(email: string): Promise<UserRow | undefined> {
  const rows = await database().db.select().from(users).where(eq(users.email, email)).limit(1)
  return rows[0]
}

beforeAll(async () => {
  provider = await startMockOidcProvider()
})

afterAll(async () => {
  await provider.close()
})

beforeEach(async () => {
  await resetDatabase()
  provider.configure()
  provider.clearRecordings()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('where the address comes from', () => {
  it('prefers what userinfo says over what the ID token said', async () => {
    app = await buildOidcApp()
    provider.configure({
      idTokenClaims: { email: 'stale@widgets.test' },
      userInfoClaims: { email: 'fresh@widgets.test', email_verified: true },
    })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/')
    expect(await memberRow('fresh@widgets.test')).toBeDefined()
    expect(await memberRow('stale@widgets.test')).toBeUndefined()
  })

  it('falls back to the ID token when userinfo cannot be read', async () => {
    app = await buildOidcApp()
    provider.configure({
      idTokenClaims: { email: 'fallback@widgets.test', groups: [ADMIN_GROUP] },
      userInfoClaims: null,
    })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/')
    const member = await memberRow('fallback@widgets.test')
    // The groups fall back with the address, so the admin mapping still applies.
    expect(member?.role).toBe('admin')
    expect(member?.roleSource).toBe('idp')
  })

  it('falls back to the ID token when userinfo returns no address', async () => {
    app = await buildOidcApp()
    provider.configure({
      idTokenClaims: { email: 'only-in-the-token@widgets.test' },
      userInfoClaims: { name: 'Someone Without An Address' },
    })

    await driveSignIn(app, provider)

    expect(await memberRow('only-in-the-token@widgets.test')).toBeDefined()
  })

  it('normalizes the address the provider spelled', async () => {
    app = await buildOidcApp()
    provider.configure({
      userInfoClaims: { email: '  Someone.Else@Widgets.TEST  ', email_verified: true },
    })

    await driveSignIn(app, provider)

    expect(await memberRow('someone.else@widgets.test')).toBeDefined()
  })

  it('refuses a sign-in neither source named an address on', async () => {
    app = await buildOidcApp()
    provider.configure({ idTokenClaims: {}, userInfoClaims: { name: 'Nobody' } })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/_/login?error=email_missing')
  })
})

describe('email_verified (spec 02 §2 step 5)', () => {
  it('accepts an address whose source said nothing about verification', async () => {
    app = await buildOidcApp()
    provider.configure({ userInfoClaims: { email: 'unstated@widgets.test' } })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/')
    expect(await memberRow('unstated@widgets.test')).toBeDefined()
  })

  it('refuses an address the provider says is not verified', async () => {
    app = await buildOidcApp()
    provider.configure({
      userInfoClaims: { email: 'unverified@widgets.test', email_verified: false },
    })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/_/login?error=email_unverified')
    expect(await memberRow('unverified@widgets.test')).toBeUndefined()
  })

  it.each(['false', '0', 'no', 'False', ' NO '])(
    'reads the string %j as not verified',
    async (claim) => {
      app = await buildOidcApp()
      provider.configure({
        userInfoClaims: { email: 'stringly@widgets.test', email_verified: claim },
      })

      const flow = await driveSignIn(app, provider)

      expect(flow.location).toBe('/_/login?error=email_unverified')
    },
  )

  it.each(['true', '1', 'yes'])('reads the string %j as verified', async (claim) => {
    app = await buildOidcApp()
    provider.configure({
      userInfoClaims: { email: 'stringly-fine@widgets.test', email_verified: claim },
    })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/')
    expect(await memberRow('stringly-fine@widgets.test')).toBeDefined()
  })

  it('judges the source that supplied the address, not the other one', async () => {
    app = await buildOidcApp()
    provider.configure({
      // The ID token disowns an address that is not the one being used.
      idTokenClaims: { email: 'stale@widgets.test', email_verified: false },
      userInfoClaims: { email: 'fresh@widgets.test', email_verified: true },
    })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/')
    expect(await memberRow('fresh@widgets.test')).toBeDefined()
  })
})

describe('groups and the admin role (spec 01 §2.3)', () => {
  it('makes a member of an admin group an admin', async () => {
    app = await buildOidcApp()
    provider.configure({
      userInfoClaims: {
        email: 'lead@widgets.test',
        email_verified: true,
        groups: ['Everyone', ADMIN_GROUP],
      },
    })

    await driveSignIn(app, provider)

    const member = await memberRow('lead@widgets.test')
    expect(member?.role).toBe('admin')
    expect(member?.roleSource).toBe('idp')
  })

  it('leaves a member who is in none of them a member', async () => {
    app = await buildOidcApp()
    provider.configure({
      userInfoClaims: { email: 'nobody@widgets.test', email_verified: true, groups: ['Everyone'] },
    })

    await driveSignIn(app, provider)

    expect((await memberRow('nobody@widgets.test'))?.role).toBe('member')
  })

  it('prefers the groups userinfo asserts over the ones in the ID token', async () => {
    app = await buildOidcApp()
    provider.configure({
      idTokenClaims: { email: 'demoted@widgets.test', groups: [ADMIN_GROUP] },
      // Userinfo is the fresher source: the member has left the group since the token was cut.
      userInfoClaims: { email: 'demoted@widgets.test', email_verified: true, groups: ['Everyone'] },
    })

    await driveSignIn(app, provider)

    expect((await memberRow('demoted@widgets.test'))?.role).toBe('member')
  })

  it('reads a comma-separated groups claim as a list', async () => {
    app = await buildOidcApp()
    provider.configure({
      userInfoClaims: {
        email: 'commas@widgets.test',
        email_verified: true,
        groups: `Everyone, ${ADMIN_GROUP}`,
      },
    })

    await driveSignIn(app, provider)

    expect((await memberRow('commas@widgets.test'))?.role).toBe('admin')
  })

  it('takes the groups from the ID token when userinfo asserts none', async () => {
    app = await buildOidcApp()
    provider.configure({
      idTokenClaims: { email: 'token-groups@widgets.test', groups: [ADMIN_GROUP] },
      userInfoClaims: { email: 'token-groups@widgets.test', email_verified: true },
    })

    await driveSignIn(app, provider)

    expect((await memberRow('token-groups@widgets.test'))?.role).toBe('admin')
  })
})

describe('the organization a sign-in resolves to (spec 01 §1.2)', () => {
  it('refuses an address outside ORG_ALLOWED_IDS', async () => {
    app = await buildOidcApp({ ORG_ALLOWED_IDS: 'widgets.test' })
    provider.configure({
      userInfoClaims: { email: 'outsider@gizmos.test', email_verified: true },
    })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/_/login?error=org_not_allowed')
    expect(await memberRow('outsider@gizmos.test')).toBeUndefined()
  })
})

// Every way a sign-in can be refused, and what the browser is told about it
// (spec 02 §2.1 and §2 step 4, spec 10 §2).
//
// The rule the whole suite is about: the member sees a code from the table in §2.1 and nothing
// else. Whatever the provider actually said stays in the log with the request id.

import { SESSION_COOKIE_NAME } from '@golinks/shared/config'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { GoLinksApp } from '../../src/types.ts'
import { insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  createCookieJar,
  driveSignIn,
  type MockOidcProvider,
  startMockOidcProvider,
} from './mock-oidc-provider.ts'
import { buildIdentityApp } from './sign-in.ts'

const database = useTestDatabase()
const WIDGETS = TEST_ORGANIZATION_IDS.widgets

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
      ...overrides,
    },
  })
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

describe('a refusal from the provider', () => {
  it('turns a declined consent into provider_error', async () => {
    app = await buildOidcApp()
    provider.configure({ authorizeError: 'access_denied' })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/_/login?error=provider_error')
    // Nothing about the provider's own error reaches the browser.
    expect(flow.location).not.toContain('access_denied')
    expect(flow.jar.get(SESSION_COOKIE_NAME)).toBeUndefined()
  })

  it('turns any other authorization error into provider_error', async () => {
    app = await buildOidcApp()
    provider.configure({ authorizeError: 'temporarily_unavailable' })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/_/login?error=provider_error')
  })

  it('refuses an ID token whose nonce is not the one that went out', async () => {
    app = await buildOidcApp()
    provider.configure({ nonceOverride: 'a-nonce-from-somewhere-else' })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/_/login?error=provider_error')
    expect(flow.jar.get(SESSION_COOKIE_NAME)).toBeUndefined()
  })

  it('refuses a code that has already been exchanged', async () => {
    app = await buildOidcApp()
    const jar = createCookieJar()

    const start = await app.inject({ method: 'GET', url: '/_/auth/start/oidc' })
    jar.accept(start.headers['set-cookie'])
    const authorize = await fetch(start.headers.location as string, { redirect: 'manual' })
    const back = new URL(authorize.headers.get('location') as string)
    const callback = `${back.pathname}${back.search}`

    const first = await app.inject({ method: 'GET', url: callback, headers: jar.headers() })
    expect(first.headers.location).toBe('/')

    // Even holding on to the sign-in cookie, the code itself is spent at the provider.
    const replay = await app.inject({ method: 'GET', url: callback, headers: jar.headers() })
    expect(replay.headers.location).toBe('/_/auth/login?error=provider_error')

    // A real browser would have dropped the cookie on the first callback, which makes the
    // same replay a mismatch instead.
    jar.accept(first.headers['set-cookie'])
    const withoutCookie = await app.inject({
      method: 'GET',
      url: callback,
      headers: jar.headers(),
    })
    expect(withoutCookie.headers.location).toBe('/_/auth/login?error=login_state_mismatch')
  })

  it('refuses a sign-in when the provider cannot be discovered at all', async () => {
    // Nothing is listening on this port, so discovery fails before the browser goes anywhere.
    app = await buildOidcApp({ OIDC_ISSUER: 'http://127.0.0.1:1' })

    const response = await app.inject({ method: 'GET', url: '/_/auth/start/oidc' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/auth/login?error=provider_error')
  })

  it('refuses a sign-in when the client secret is not the one the provider knows', async () => {
    app = await buildOidcApp({ OIDC_CLIENT_SECRET: 'the-wrong-secret' })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/_/login?error=provider_error')
  })
})

describe('a member the service refuses', () => {
  it('refuses a disabled account and leaves no session behind', async () => {
    await insertOrganization(database().db, WIDGETS)
    await insertUser(database().db, {
      email: 'disabled@widgets.test',
      organizationId: WIDGETS,
      isEnabled: false,
    })

    app = await buildOidcApp()
    provider.configure({
      userInfoClaims: { email: 'disabled@widgets.test', email_verified: true },
    })

    const flow = await driveSignIn(app, provider)

    expect(flow.location).toBe('/_/login?error=account_disabled')
    expect(flow.jar.get(SESSION_COOKIE_NAME)).toBeUndefined()

    const me = await app.inject({
      method: 'GET',
      url: '/_/api/v1/me',
      headers: flow.jar.headers(),
    })
    expect(me.statusCode).toBe(401)
  })
})

describe('what the sign-in page is told', () => {
  it('carries only the codes the page has a message for', async () => {
    app = await buildOidcApp()

    const response = await app.inject({
      method: 'GET',
      // A code the page could not explain is dropped rather than shown.
      url: '/_/auth/login?error=%3Cscript%3E',
    })

    expect(response.headers.location).toBe('/_/auth/start/oidc')
  })

  it('shows every code of spec 02 §2.1 through the same route', async () => {
    app = await buildOidcApp()

    for (const code of [
      'account_disabled',
      'org_not_allowed',
      'email_missing',
      'email_unverified',
      'login_state_mismatch',
      'provider_error',
    ]) {
      const response = await app.inject({ method: 'GET', url: `/_/auth/login?error=${code}` })
      expect(response.headers.location).toBe(`/_/login?error=${code}`)
    }
  })
})

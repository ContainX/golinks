// The sign-in flow end to end against a real provider (spec 02 §2, spec 10 §2).
//
// Every hop is walked the way a browser walks it: the service's routes through `app.inject`,
// the provider's through a real request, and a cookie jar in between. What the suite proves is
// the whole conversation — the parameters that go out, the checks on the way back, and the
// session the member is left holding.

import { API_BASE_PATH } from '@golinks/shared/api'
import { LOGIN_COOKIE_NAME, SESSION_COOKIE_NAME } from '@golinks/shared/config'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { GoLinksApp } from '../../src/types.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  createCookieJar,
  driveSignIn,
  type MockOidcProvider,
  startMockOidcProvider,
} from './mock-oidc-provider.ts'
import { buildIdentityApp, TEST_BASE_URL } from './sign-in.ts'

const database = useTestDatabase()
const ME_URL = `${API_BASE_PATH}/me`

let provider: MockOidcProvider
let app: GoLinksApp | undefined

/** The environment an OIDC deployment has: one provider, the mock, and no test sign-in. */
function oidcEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    AUTH_TEST_MODE: 'false',
    OIDC_ISSUER: provider.issuer,
    OIDC_CLIENT_ID: provider.clientId,
    OIDC_CLIENT_SECRET: provider.clientSecret,
    OIDC_SCOPES: 'openid email profile groups',
    ...overrides,
  }
}

function buildOidcApp(overrides: Record<string, string> = {}): Promise<GoLinksApp> {
  return buildIdentityApp({ database: database().db, environment: oidcEnvironment(overrides) })
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

describe('signing in through an identity provider', () => {
  it('walks login, start, the provider, and the callback into a session', async () => {
    app = await buildOidcApp()

    const flow = await driveSignIn(app, provider, {
      start: '/_/auth/login?redirectTo=%2Fhandbook',
    })

    // Spec 02 §2 step 1: one provider and no error is a redirect straight to the start route.
    expect(flow.hops[0]?.location).toBe('/_/auth/start/oidc?redirectTo=%2Fhandbook')
    expect(flow.hops[1]?.location?.startsWith(`${provider.issuer}/authorize`)).toBe(true)
    expect(flow.hops[2]?.location?.startsWith(`${TEST_BASE_URL}/_/auth/callback/oidc`)).toBe(true)
    // Spec 02 §2 step 8: the member lands where they were going.
    expect(flow.location).toBe('/handbook')

    // The sign-in cookie has done its job and is gone; the session cookie has replaced it.
    expect(flow.jar.get(LOGIN_COOKIE_NAME)).toBeUndefined()
    expect(flow.jar.get(SESSION_COOKIE_NAME)).toBeDefined()

    const me = await app.inject({ method: 'GET', url: ME_URL, headers: flow.jar.headers() })
    expect(me.statusCode).toBe(200)
    expect(me.json().user).toMatchObject({
      email: 'someone@widgets.test',
      organizationId: 'widgets.test',
      role: 'member',
    })
  })

  it('asks for a code with the scopes, state, nonce, and an S256 challenge', async () => {
    app = await buildOidcApp()

    await driveSignIn(app, provider)

    const authorize = provider.lastAuthorizeRequest()
    expect(authorize.get('response_type')).toBe('code')
    expect(authorize.get('client_id')).toBe(provider.clientId)
    expect(authorize.get('scope')).toBe('openid email profile groups')
    expect(authorize.get('redirect_uri')).toBe(`${TEST_BASE_URL}/_/auth/callback/oidc`)
    expect(authorize.get('code_challenge_method')).toBe('S256')
    expect(authorize.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorize.get('state')).toBeTruthy()
    expect(authorize.get('nonce')).toBeTruthy()
  })

  it('exchanges the code with the verifier and the client secret', async () => {
    app = await buildOidcApp()

    await driveSignIn(app, provider)

    const exchange = provider.tokenRequests.at(-1)
    expect(exchange?.grant_type).toBe('authorization_code')
    expect(exchange?.code_verifier).toBeTruthy()
    // The mock refuses a request whose credentials or verifier do not hold, so reaching a
    // session at all is the proof; this asserts which way the client authenticated.
    expect(exchange?.client_secret ?? '').toBe(provider.clientSecret)
    expect(exchange?.redirect_uri).toBe(`${TEST_BASE_URL}/_/auth/callback/oidc`)
  })

  it('keeps the sign-in cookie signed, HttpOnly, and scoped to the auth routes', async () => {
    app = await buildOidcApp()

    const start = await app.inject({ method: 'GET', url: '/_/auth/start/oidc' })
    const header = start.headers['set-cookie']
    const cookie = Array.isArray(header) ? header[0] : header
    const attributes = (cookie ?? '').split(';').map((part) => part.trim())

    expect(attributes[0]?.startsWith(`${LOGIN_COOKIE_NAME}=`)).toBe(true)
    expect(attributes).toContain('HttpOnly')
    expect(attributes).toContain('SameSite=Lax')
    expect(attributes).toContain('Path=/_/auth')
    // Ten minutes, in seconds (spec 02 §2 step 2).
    expect(attributes).toContain('Max-Age=600')
  })

  it('sends a member who is already signed in straight on', async () => {
    app = await buildOidcApp()

    const flow = await driveSignIn(app, provider)
    expect(flow.location).toBe('/')

    const again = await app.inject({
      method: 'GET',
      url: '/_/auth/login?redirectTo=%2Fteam%2Fhandbook',
      headers: flow.jar.headers(),
    })
    expect(again.statusCode).toBe(302)
    expect(again.headers.location).toBe('/team/handbook')
    // Nothing was asked of the provider a second time.
    expect(provider.authorizeRequests).toHaveLength(1)
  })

  it('answers a provider id nothing is configured under with 404', async () => {
    app = await buildOidcApp()

    const start = await app.inject({ method: 'GET', url: '/_/auth/start/entra' })
    expect(start.statusCode).toBe(404)
    expect(start.json().error.code).toBe('not_found')

    const callback = await app.inject({ method: 'GET', url: '/_/auth/callback/entra?code=x' })
    expect(callback.statusCode).toBe(404)
  })
})

describe('choosing between providers (spec 02 §2 step 1)', () => {
  it('shortcuts to the only provider that is configured', async () => {
    app = await buildOidcApp()

    const response = await app.inject({ method: 'GET', url: '/_/auth/login' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/auth/start/oidc')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('sends the browser to the sign-in page when several are configured', async () => {
    app = await buildOidcApp({
      OIDC_PROVIDERS_JSON: JSON.stringify([
        {
          id: 'okta',
          label: 'Sign in with Okta',
          issuer: provider.issuer,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
        },
        {
          id: 'entra',
          label: 'Sign in with Entra',
          issuer: provider.issuer,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
        },
      ]),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/_/auth/login?redirectTo=%2Fhandbook',
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/login?redirectTo=%2Fhandbook')
  })

  it('sends the browser to the sign-in page when an error has to be shown', async () => {
    app = await buildOidcApp()

    const response = await app.inject({
      method: 'GET',
      url: '/_/auth/login?error=account_disabled&redirectTo=%2Fhandbook',
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/login?redirectTo=%2Fhandbook&error=account_disabled')
  })

  it('offers the sign-in page even where no provider is configured at all', async () => {
    // The shape a deployment running on the test sign-in of spec 02 §8 alone has.
    app = await buildIdentityApp({
      database: database().db,
      environment: { OIDC_ISSUER: '', OIDC_CLIENT_ID: '', OIDC_CLIENT_SECRET: '' },
    })

    const response = await app.inject({ method: 'GET', url: '/_/auth/login' })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/login')

    const start = await app.inject({ method: 'GET', url: '/_/auth/start/oidc' })
    expect(start.statusCode).toBe(404)
  })
})

describe('redirectTo (spec 02 §2.2)', () => {
  it('neutralizes an open redirect before it ever reaches the provider', async () => {
    app = await buildOidcApp()

    const flow = await driveSignIn(app, provider, {
      start: '/_/auth/login?redirectTo=%2F%2Fevil.test%2Fsteal',
    })

    expect(flow.hops[0]?.location).toBe('/_/auth/start/oidc')
    expect(flow.location).toBe('/')
  })

  it('refuses an absolute URL smuggled into the start route', async () => {
    app = await buildOidcApp()

    const flow = await driveSignIn(app, provider, {
      start: '/_/auth/start/oidc?redirectTo=https%3A%2F%2Fevil.test%2Fsteal',
    })

    expect(flow.location).toBe('/')
  })

  it('keeps a keyword path with its query, which is what the resolver sends', async () => {
    app = await buildOidcApp()

    const flow = await driveSignIn(app, provider, {
      start: '/_/auth/login?redirectTo=%2Fjira%2FACME-1%3Fvia%3Dsearch',
    })

    expect(flow.location).toBe('/jira/ACME-1?via=search')
  })

  it('carries the path through a failed attempt so a retry still lands there', async () => {
    app = await buildOidcApp()
    provider.configure({ authorizeError: 'access_denied' })

    const flow = await driveSignIn(app, provider, {
      start: '/_/auth/login?redirectTo=%2Fhandbook',
    })

    expect(flow.location).toBe('/_/login?redirectTo=%2Fhandbook&error=provider_error')
  })
})

describe('the cookie the callback is judged by', () => {
  it('refuses a callback that carries no sign-in attempt', async () => {
    app = await buildOidcApp()

    const response = await app.inject({
      method: 'GET',
      url: '/_/auth/callback/oidc?code=whatever&state=whatever',
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/auth/login?error=login_state_mismatch')
  })

  it('refuses a callback whose state does not match the attempt', async () => {
    app = await buildOidcApp()
    const jar = createCookieJar()

    const start = await app.inject({ method: 'GET', url: '/_/auth/start/oidc' })
    jar.accept(start.headers['set-cookie'])

    const authorizeUrl = start.headers.location as string
    const authorize = await fetch(authorizeUrl, { redirect: 'manual' })
    const back = new URL(authorize.headers.get('location') as string)
    back.searchParams.set('state', 'not-the-state-that-went-out')

    const response = await app.inject({
      method: 'GET',
      url: `${back.pathname}${back.search}`,
      headers: jar.headers(),
    })

    expect(response.headers.location).toBe('/_/auth/login?error=login_state_mismatch')
    // The attempt is spent either way, so a second try starts from scratch.
    jar.accept(response.headers['set-cookie'])
    expect(jar.get(LOGIN_COOKIE_NAME)).toBeUndefined()
  })

  it('refuses an attempt that was made for another provider', async () => {
    app = await buildOidcApp({
      OIDC_PROVIDERS_JSON: JSON.stringify([
        {
          id: 'okta',
          issuer: provider.issuer,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
        },
        {
          id: 'entra',
          issuer: provider.issuer,
          clientId: provider.clientId,
          clientSecret: provider.clientSecret,
        },
      ]),
    })
    const jar = createCookieJar()

    const start = await app.inject({ method: 'GET', url: '/_/auth/start/okta' })
    jar.accept(start.headers['set-cookie'])

    const authorize = await fetch(start.headers.location as string, { redirect: 'manual' })
    const back = new URL(authorize.headers.get('location') as string)

    const response = await app.inject({
      method: 'GET',
      url: `/_/auth/callback/entra${back.search}`,
      headers: jar.headers(),
    })

    expect(response.headers.location).toBe('/_/auth/login?error=login_state_mismatch')
  })

  it('refuses a sign-in cookie that has been rewritten', async () => {
    app = await buildOidcApp()

    const start = await app.inject({ method: 'GET', url: '/_/auth/start/oidc' })
    const authorize = await fetch(start.headers.location as string, { redirect: 'manual' })
    const back = new URL(authorize.headers.get('location') as string)

    const response = await app.inject({
      method: 'GET',
      url: `${back.pathname}${back.search}`,
      headers: { cookie: `${LOGIN_COOKIE_NAME}=forged-value` },
    })

    expect(response.headers.location).toBe('/_/auth/login?error=login_state_mismatch')
  })
})

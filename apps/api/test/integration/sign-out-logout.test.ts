// Sign-out, with and without ending the session at the provider (spec 02 §4).
//
// Locally the answer is always the same — the session record is gone, the cookie is cleared,
// and the browser lands on the signed-out page. What changes is whether the member is sent on
// to the provider afterwards, which is the only way to end the session they hold there too.

import { API_BASE_PATH } from '@golinks/shared/api'
import { SESSION_COOKIE_NAME } from '@golinks/shared/config'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { SIGN_OUT_PATH, SIGNED_OUT_PATH } from '../../src/auth/sign-out.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  type CookieJar,
  driveSignIn,
  type MockOidcProvider,
  startMockOidcProvider,
} from './mock-oidc-provider.ts'
import { buildIdentityApp, signIn, TEST_BASE_URL } from './sign-in.ts'

const database = useTestDatabase()
const ME_URL = `${API_BASE_PATH}/me`

/** Spec 02 §6 holds sign-out to the deployment's own origin, on GET as well as POST. */
const ORIGIN = { origin: TEST_BASE_URL }

let provider: MockOidcProvider
/** A second provider that has no end-session endpoint to advertise. */
let quietProvider: MockOidcProvider
let app: GoLinksApp | undefined

function buildOidcApp(overrides: Record<string, string> = {}): Promise<GoLinksApp> {
  return buildIdentityApp({
    database: database().db,
    environment: {
      AUTH_TEST_MODE: 'false',
      OIDC_ISSUER: provider.issuer,
      OIDC_CLIENT_ID: provider.clientId,
      OIDC_CLIENT_SECRET: provider.clientSecret,
      ...overrides,
    },
  })
}

/** Signs in through the provider and hands back the browser's cookies. */
async function signedInBrowser(instance: GoLinksApp): Promise<CookieJar> {
  const flow = await driveSignIn(instance, provider)
  expect(flow.location).toBe('/')
  expect(flow.jar.get(SESSION_COOKIE_NAME)).toBeDefined()
  return flow.jar
}

beforeAll(async () => {
  provider = await startMockOidcProvider()
  quietProvider = await startMockOidcProvider({ advertisesEndSession: false })
})

afterAll(async () => {
  await provider.close()
  await quietProvider.close()
})

beforeEach(async () => {
  await resetDatabase()
  provider.configure()
  provider.clearRecordings()
  quietProvider.configure()
  quietProvider.clearRecordings()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('signing out locally', () => {
  it('destroys the session and lands on the signed-out page', async () => {
    app = await buildOidcApp()
    const jar = await signedInBrowser(app)

    const response = await app.inject({
      method: 'POST',
      url: SIGN_OUT_PATH,
      headers: jar.headers(ORIGIN),
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(SIGNED_OUT_PATH)
    expect(response.headers.location).toBe('/_/login?signedOut=1')
    expect(response.headers['cache-control']).toBe('no-store')

    // The cookie is cleared, and the record behind it is gone even if the cookie were kept.
    jar.accept(response.headers['set-cookie'])
    expect(jar.get(SESSION_COOKIE_NAME)).toBeUndefined()
  })

  it('leaves the session unusable even for a browser that keeps the cookie', async () => {
    app = await buildOidcApp()
    const jar = await signedInBrowser(app)
    const kept = jar.headers()

    await app.inject({ method: 'POST', url: SIGN_OUT_PATH, headers: jar.headers(ORIGIN) })

    const me = await app.inject({ method: 'GET', url: ME_URL, headers: kept })
    expect(me.statusCode).toBe(401)
  })

  it('accepts a plain link, which is what a GET sign-out is for', async () => {
    app = await buildOidcApp()
    const jar = await signedInBrowser(app)

    const response = await app.inject({
      method: 'GET',
      url: SIGN_OUT_PATH,
      headers: jar.headers(ORIGIN),
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(SIGNED_OUT_PATH)
  })

  it('accepts the Referer a plain link sends in place of an Origin', async () => {
    app = await buildOidcApp()
    const jar = await signedInBrowser(app)

    const response = await app.inject({
      method: 'GET',
      url: SIGN_OUT_PATH,
      headers: jar.headers({ referer: `${TEST_BASE_URL}/_/settings` }),
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(SIGNED_OUT_PATH)
  })

  it('answers a member who was not signed in with the same page', async () => {
    app = await buildOidcApp()

    const response = await app.inject({ method: 'POST', url: SIGN_OUT_PATH, headers: ORIGIN })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(SIGNED_OUT_PATH)
  })

  it('signs out a session that was opened by the test sign-in', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const response = await app.inject({
      method: 'POST',
      url: SIGN_OUT_PATH,
      headers: { cookie: session.cookie, ...ORIGIN },
    })

    expect(response.headers.location).toBe(SIGNED_OUT_PATH)
  })

  it('refuses a sign-out that came from somewhere else (spec 02 §6)', async () => {
    app = await buildOidcApp()
    const jar = await signedInBrowser(app)

    for (const method of ['POST', 'GET'] as const) {
      const response = await app.inject({
        method,
        url: SIGN_OUT_PATH,
        headers: jar.headers({ origin: 'https://evil.test' }),
      })
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('csrf_origin_mismatch')
    }

    // The session survived the attempt.
    const me = await app.inject({ method: 'GET', url: ME_URL, headers: jar.headers() })
    expect(me.statusCode).toBe(200)
  })
})

describe('ending the session at the provider (RP-initiated logout)', () => {
  it('sends the browser to the end-session endpoint with the ID token as the hint', async () => {
    app = await buildOidcApp({ OIDC_LOGOUT_AT_IDP: 'true' })
    const jar = await signedInBrowser(app)

    const response = await app.inject({
      method: 'POST',
      url: SIGN_OUT_PATH,
      headers: jar.headers(ORIGIN),
    })

    expect(response.statusCode).toBe(302)
    const location = new URL(response.headers.location as string)
    expect(location.href.startsWith(`${provider.issuer}/end-session`)).toBe(true)
    expect(location.searchParams.get('post_logout_redirect_uri')).toBe(`${TEST_BASE_URL}/`)
    expect(location.searchParams.get('id_token_hint')).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/)

    // The local session is gone before the browser ever reaches the provider.
    jar.accept(response.headers['set-cookie'])
    expect(jar.get(SESSION_COOKIE_NAME)).toBeUndefined()

    // The provider is asked for real, and sends the member back to the canonical origin.
    const atProvider = await fetch(location.href, { redirect: 'manual' })
    expect(atProvider.status).toBe(302)
    expect(atProvider.headers.get('location')).toBe(`${TEST_BASE_URL}/`)
    expect(provider.endSessionRequests).toHaveLength(1)
    expect(provider.endSessionRequests[0]?.get('id_token_hint')).toBe(
      location.searchParams.get('id_token_hint'),
    )
  })

  it('stays local when the deployment has not asked for it', async () => {
    app = await buildOidcApp()
    const jar = await signedInBrowser(app)

    const response = await app.inject({
      method: 'POST',
      url: SIGN_OUT_PATH,
      headers: jar.headers(ORIGIN),
    })

    expect(response.headers.location).toBe(SIGNED_OUT_PATH)
    expect(provider.endSessionRequests).toHaveLength(0)
  })

  it('stays local when the provider advertises no end-session endpoint', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: {
        AUTH_TEST_MODE: 'false',
        OIDC_LOGOUT_AT_IDP: 'true',
        OIDC_ISSUER: quietProvider.issuer,
        OIDC_CLIENT_ID: quietProvider.clientId,
        OIDC_CLIENT_SECRET: quietProvider.clientSecret,
      },
    })

    const flow = await driveSignIn(app, quietProvider)
    expect(flow.location).toBe('/')

    const response = await app.inject({
      method: 'POST',
      url: SIGN_OUT_PATH,
      headers: flow.jar.headers(ORIGIN),
    })

    expect(response.headers.location).toBe(SIGNED_OUT_PATH)
  })

  it('stays local for a session that never held an ID token', async () => {
    // The test sign-in of spec 02 §8 has no ID token to present as a hint.
    app = await buildIdentityApp({
      database: database().db,
      environment: {
        OIDC_LOGOUT_AT_IDP: 'true',
        OIDC_ISSUER: provider.issuer,
        OIDC_CLIENT_ID: provider.clientId,
        OIDC_CLIENT_SECRET: provider.clientSecret,
      },
    })
    const session = await signIn(app)

    const response = await app.inject({
      method: 'POST',
      url: SIGN_OUT_PATH,
      headers: { cookie: session.cookie, ...ORIGIN },
    })

    expect(response.headers.location).toBe(SIGNED_OUT_PATH)
    expect(provider.endSessionRequests).toHaveLength(0)
  })
})

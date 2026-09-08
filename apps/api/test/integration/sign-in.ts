// Signing in from an integration test (spec 02 §8).
//
// The test sign-in endpoint exists so that a suite never has to stand up an identity provider.
// This module mints the tokens it accepts and turns one into the `Cookie` header every later
// request carries, so a suite becomes a member in a line:
//
// ```ts
// const app = await buildTestApp({ environment: testAuthEnvironment(), database, plugins: [...] })
// const session = await signIn(app)
// await app.inject({ method: 'GET', url: '/_/api/v1/me', headers: session.headers })
// ```

import type { SessionStore } from '@fastify/session'
import type { EnvironmentInput } from '@golinks/shared/config'
import { SESSION_COOKIE_NAME } from '@golinks/shared/config'
import { SignJWT } from 'jose'
import type { IdentityOptions } from '../../src/auth/plugin.ts'
import { createIdentityPlugin } from '../../src/auth/plugin.ts'
import { TEST_LOGIN_PATH } from '../../src/auth/test-login.ts'
import type { Database } from '../../src/db/client.ts'
import { buildTestApp } from '../../src/testing/fixtures.ts'
import type { GoLinksApp } from '../../src/types.ts'

/** The shared secret every minted token is signed with. */
export const TEST_AUTH_SECRET = 'test-sign-in-secret-that-is-long-enough'

/** Domains the test sign-in accepts, matching the organizations in `fixtures.ts`. */
export const TEST_AUTH_DOMAINS = ['widgets.test', 'gizmos.test'] as const

/** The member a suite signs in as unless it says otherwise. */
export const TEST_MEMBER_EMAIL = 'someone@widgets.test'

/**
 * The origin an integration app is built on.
 *
 * Plain http on the loopback interface, which is the one case spec 02 §3 leaves `Secure` off
 * the session cookie. `app.inject` speaks http, so a Secure cookie would never be written and
 * no test could carry a session from one request to the next.
 */
export const TEST_BASE_URL = 'http://localhost:3000'

/** Token lifetime a suite gets when it does not care: comfortably inside the five-minute cap. */
const DEFAULT_TOKEN_LIFETIME_MS = 60_000

/** Environment overrides that turn the test sign-in on (spec 02 §8) over a usable origin. */
export function testAuthEnvironment(overrides: EnvironmentInput = {}): EnvironmentInput {
  return {
    BASE_URL: TEST_BASE_URL,
    AUTH_TEST_MODE: 'true',
    AUTH_TEST_SECRET: TEST_AUTH_SECRET,
    AUTH_TEST_DOMAINS: TEST_AUTH_DOMAINS.join(','),
    ...overrides,
  }
}

export interface TestTokenOptions {
  /** Defaults to `someone@widgets.test`. */
  email?: string
  /** Groups the token asserts, for the admin mapping of spec 01 §2.3. */
  groups?: readonly string[]
  /** Group names the token declares as conferring the admin role. */
  adminGroups?: readonly string[]
  /** Defaults to the shared secret; another value produces a bad signature. */
  secret?: string
  /** How far ahead `exp` sits. Negative values mint an already-expired token. */
  expiresInMs?: number
}

/** Mints an HS256 token the test sign-in endpoint accepts. */
export async function mintTestLoginToken(options: TestTokenOptions = {}): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const lifetime = options.expiresInMs ?? DEFAULT_TOKEN_LIFETIME_MS
  const claims: Record<string, unknown> = { email: options.email ?? TEST_MEMBER_EMAIL }
  if (options.groups !== undefined) claims.groups = [...options.groups]
  if (options.adminGroups !== undefined) claims.adminGroups = [...options.adminGroups]

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(nowSeconds)
    .setExpirationTime(nowSeconds + Math.round(lifetime / 1000))
    .sign(new TextEncoder().encode(options.secret ?? TEST_AUTH_SECRET))
}

export interface SignedInSession {
  /** The `Cookie` header value to send on later requests. */
  cookie: string
  /** Headers a plain read carries: just the cookie. */
  headers: { cookie: string }
  /** Headers a state-changing API request carries: the cookie and the Origin (spec 02 §6). */
  apiHeaders: { cookie: string; origin: string; 'content-type': string }
  /** The whole `Set-Cookie` header, for a test that asserts on its attributes. */
  setCookie: string
}

/** The `name=value` pair of the session cookie in a response, or undefined when none was set. */
export function readSessionCookie(setCookie: string | string[] | undefined): string | undefined {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie]
  return headers.find((header) => header.startsWith(`${SESSION_COOKIE_NAME}=`))
}

/**
 * Signs in through `POST /_/auth/test-login` and returns the headers later requests carry.
 * The app must have been built with `testAuthEnvironment()` and the identity plugin.
 */
export async function signIn(
  app: GoLinksApp,
  options: TestTokenOptions = {},
): Promise<SignedInSession> {
  const token = await mintTestLoginToken(options)
  const response = await app.inject({
    method: 'POST',
    url: TEST_LOGIN_PATH,
    payload: { token },
  })

  if (response.statusCode !== 204) {
    throw new Error(`Test sign-in failed with ${response.statusCode}: ${response.body}`)
  }

  const setCookie = readSessionCookie(response.headers['set-cookie'])
  if (setCookie === undefined) {
    throw new Error('The test sign-in set no session cookie.')
  }

  const cookie = setCookie.split(';', 1)[0] ?? ''
  return {
    cookie,
    headers: { cookie },
    // Spec 02 §6 holds every state-changing API request to the deployment's own origin.
    apiHeaders: {
      cookie,
      origin: app.appConfig.baseUrl,
      'content-type': 'application/json',
    },
    setCookie,
  }
}

export interface IdentityAppOptions {
  /** The harness database every query runs against. */
  database: Database
  /** Environment overrides on top of `testAuthEnvironment()`. */
  environment?: EnvironmentInput
  /** Cache lifetime and clock for the member resolver. */
  identity?: IdentityOptions
  /** Overrides the session store; the in-process one is used otherwise. */
  sessionStore?: SessionStore
  /** Extra registrations, for a suite that adds routes of its own. */
  plugins?: readonly ((app: GoLinksApp) => void | Promise<void>)[]
}

/**
 * A silent instance with the identity foundation installed and the test sign-in enabled.
 * The one line a suite needs before it can call `signIn`.
 */
export function buildIdentityApp(options: IdentityAppOptions): Promise<GoLinksApp> {
  return buildTestApp({
    environment: testAuthEnvironment(options.environment),
    database: options.database,
    ...(options.sessionStore === undefined ? {} : { sessionStore: options.sessionStore }),
    plugins: [createIdentityPlugin(options.identity ?? {}), ...(options.plugins ?? [])],
  })
}

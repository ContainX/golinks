// Turning a session cookie into `request.member`, request after request (spec 02 §3, §5).

import { API_BASE_PATH } from '@golinks/shared/api'
import { SESSION_COOKIE_NAME } from '@golinks/shared/config'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPostgresSessionStore } from '../../src/auth/session-stores.ts'
import { users } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { buildIdentityApp, readSessionCookie, signIn, TEST_MEMBER_EMAIL } from './sign-in.ts'

const database = useTestDatabase()
const ME_URL = `${API_BASE_PATH}/me`
const MEMBER_URL = '/_/test/member'
const DAY = 24 * 60 * 60 * 1000

/** Echoes `request.member` itself, which is what the user cache actually governs. */
const memberEchoRoute = (instance: GoLinksApp): void => {
  instance.route({
    method: 'GET',
    url: MEMBER_URL,
    handler: async (request, reply) => reply.send(request.member ?? { role: null }),
  })
}

let app: GoLinksApp | undefined

function attributesOf(setCookie: string | string[] | undefined): string[] {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return (header ?? '').split(';').map((part) => part.trim())
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('the session cookie a sign-in writes', () => {
  it('carries only a 32-byte id, signed, with the attributes spec 02 §3 fixes', async () => {
    app = await buildIdentityApp({ database: database().db })

    const session = await signIn(app)
    const attributes = attributesOf(session.setCookie)

    expect(attributes[0]).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=`))
    expect(attributes).toContain('HttpOnly')
    expect(attributes).toContain('SameSite=Lax')
    expect(attributes).toContain('Path=/')
    expect(attributes.some((attribute) => attribute.startsWith('Domain='))).toBe(false)
    // A plain-http loopback deployment is the one case Secure comes off.
    expect(attributes).not.toContain('Secure')

    const value = decodeURIComponent(session.cookie.slice(`${SESSION_COOKIE_NAME}=`.length))
    const [id, signature] = value.split('.')
    expect(Buffer.from(id ?? '', 'base64url')).toHaveLength(32)
    expect(signature).toBeTruthy()
  })

  it('re-issues the cookie on every request, so the expiry slides', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const later = await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })

    expect(later.statusCode).toBe(200)
    // Same session, later expiry: the member stays signed in as long as they keep coming back.
    expect(readSessionCookie(later.headers['set-cookie'])).toContain(session.cookie)
    expect(expiryOf(later.headers['set-cookie'])).toBeGreaterThanOrEqual(
      expiryOf(session.setCookie),
    )
  })

  it('never slides the expiry past the absolute maximum measured from sign-in', async () => {
    let now = Date.now()
    const signedInAt = now
    const store = createPostgresSessionStore(database().db, {
      maxAgeMs: 30 * DAY,
      now: () => now,
    })
    app = await buildIdentityApp({
      database: database().db,
      sessionStore: store,
      identity: { now: () => now },
    })

    const session = await signIn(app)

    // Ten days into the session, only twenty are left however often the member comes back.
    now = signedInAt + 10 * DAY
    const later = await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })

    expect(later.statusCode).toBe(200)
    const remaining = expiryOf(later.headers['set-cookie']) - Date.now()
    expect(remaining).toBeGreaterThan(19 * DAY)
    expect(remaining).toBeLessThan(21 * DAY)
  })
})

function expiryOf(setCookie: string | string[] | undefined): number {
  const expires = attributesOf(setCookie).find((attribute) => attribute.startsWith('Expires='))
  return Date.parse(expires?.slice('Expires='.length) ?? '')
}

describe('resolving the member behind a request', () => {
  it('reads the session, then the user row, then answers as that member', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const response = await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })

    expect(response.statusCode).toBe(200)
    expect(response.json().user).toMatchObject({
      email: TEST_MEMBER_EMAIL,
      organizationId: 'widgets.test',
      role: 'member',
    })
  })

  it('treats a request with no cookie as unauthenticated', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await app.inject({ method: 'GET', url: ME_URL })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('unauthenticated')
  })

  it('treats a forged cookie as unauthenticated', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await app.inject({
      method: 'GET',
      url: ME_URL,
      headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-real-session.and-not-a-signature` },
    })

    expect(response.statusCode).toBe(401)
  })

  it('holds the user lookup for the cache lifetime and no longer', async () => {
    let now = Date.now()
    app = await buildIdentityApp({
      database: database().db,
      identity: { now: () => now },
      plugins: [memberEchoRoute],
    })
    const session = await signIn(app)

    await database()
      .db.update(users)
      .set({ role: 'admin' })
      .where(eq(users.email, TEST_MEMBER_EMAIL))

    // Inside the window the cached copy still says member (spec 02 §3).
    const cached = await app.inject({ method: 'GET', url: MEMBER_URL, headers: session.headers })
    expect(cached.json().role).toBe('member')

    now += 60_000
    const fresh = await app.inject({ method: 'GET', url: MEMBER_URL, headers: session.headers })
    expect(fresh.json().role).toBe('admin')
  })

  it('reads the row on every request when the cache is switched off', async () => {
    app = await buildIdentityApp({
      database: database().db,
      identity: { memberCacheTtlMs: 0 },
      plugins: [memberEchoRoute],
    })
    const session = await signIn(app)

    await database()
      .db.update(users)
      .set({ role: 'admin' })
      .where(eq(users.email, TEST_MEMBER_EMAIL))

    const response = await app.inject({ method: 'GET', url: MEMBER_URL, headers: session.headers })
    expect(response.json().role).toBe('admin')
  })
})

describe('session lifetimes end to end', () => {
  it('ends a session at the absolute maximum however active the member was', async () => {
    let now = Date.now()
    const store = createPostgresSessionStore(database().db, {
      maxAgeMs: 2 * DAY,
      now: () => now,
    })
    app = await buildIdentityApp({
      database: database().db,
      environment: { SESSION_MAX_AGE: '2d' },
      sessionStore: store,
      identity: { now: () => now, memberCacheTtlMs: 0 },
    })
    const session = await signIn(app)

    now += DAY
    await expect(
      app.inject({ method: 'GET', url: ME_URL, headers: session.headers }),
    ).resolves.toMatchObject({ statusCode: 200 })

    now += DAY
    await expect(
      app.inject({ method: 'GET', url: ME_URL, headers: session.headers }),
    ).resolves.toMatchObject({ statusCode: 401 })
  })

  it('ends an idle session at the idle timeout', async () => {
    let now = Date.now()
    const store = createPostgresSessionStore(database().db, {
      maxAgeMs: 30 * DAY,
      idleTimeoutMs: 60_000,
      now: () => now,
    })
    app = await buildIdentityApp({
      database: database().db,
      environment: { SESSION_IDLE_TIMEOUT: '1m' },
      sessionStore: store,
      identity: { now: () => now, memberCacheTtlMs: 0 },
    })
    const session = await signIn(app)

    now += 30_000
    await expect(
      app.inject({ method: 'GET', url: ME_URL, headers: session.headers }),
    ).resolves.toMatchObject({ statusCode: 200 })

    // The last request refreshed last-seen, so the timeout runs from there.
    now += 60_000
    await expect(
      app.inject({ method: 'GET', url: ME_URL, headers: session.headers }),
    ).resolves.toMatchObject({ statusCode: 401 })
  })
})

describe('the rate-limit subject', () => {
  it('counts the API per session rather than per address (spec 05 §5)', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: { RATE_LIMIT_API: '5' },
    })

    const first = await signIn(app)
    const second = await signIn(app, { email: 'other@widgets.test' })

    const firstUse = await app.inject({ method: 'GET', url: ME_URL, headers: first.headers })
    const firstAgain = await app.inject({ method: 'GET', url: ME_URL, headers: first.headers })
    const secondUse = await app.inject({ method: 'GET', url: ME_URL, headers: second.headers })

    expect(Number(firstAgain.headers['x-ratelimit-remaining'])).toBeLessThan(
      Number(firstUse.headers['x-ratelimit-remaining']),
    )
    // A second session shares the address but not the budget.
    expect(Number(secondUse.headers['x-ratelimit-remaining'])).toBe(
      Number(firstUse.headers['x-ratelimit-remaining']),
    )
  })
})

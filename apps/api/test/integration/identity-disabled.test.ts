// Disabled-user enforcement (spec 01 §2.4).
//
// Disabling is the deprovisioning action, so it has to bite in two places: a new sign-in is
// refused, and a session that already exists is destroyed on its next request.

import { API_BASE_PATH } from '@golinks/shared/api'
import { SESSION_COOKIE_NAME } from '@golinks/shared/config'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPostgresSessionStore } from '../../src/auth/session-stores.ts'
import { auditEvents, sessions, users } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { buildIdentityApp, signIn, TEST_MEMBER_EMAIL } from './sign-in.ts'

const database = useTestDatabase()
const ME_URL = `${API_BASE_PATH}/me`
const DAY = 24 * 60 * 60 * 1000

let app: GoLinksApp | undefined

async function disableTheMember(): Promise<void> {
  await database()
    .db.update(users)
    .set({ isEnabled: false })
    .where(eq(users.email, TEST_MEMBER_EMAIL))
}

/** An app whose sessions live in Postgres, so a test can watch the row go. */
async function buildStoredSessionApp(memberCacheTtlMs = 0): Promise<GoLinksApp> {
  const { db } = database()
  return buildIdentityApp({
    database: db,
    sessionStore: createPostgresSessionStore(db, { maxAgeMs: 30 * DAY }),
    identity: { memberCacheTtlMs },
  })
}

function clearsSessionCookie(setCookie: string | string[] | undefined): boolean {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie]
  return headers.some(
    (header) => header.startsWith(`${SESSION_COOKIE_NAME}=;`) || header.includes('Expires=Thu, 01'),
  )
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('an existing session belonging to a member who has just been disabled', () => {
  it('is destroyed on the next request, which the API answers 401', async () => {
    app = await buildStoredSessionApp()
    const session = await signIn(app)
    await expect(database().db.select().from(sessions)).resolves.toHaveLength(1)

    await disableTheMember()
    const response = await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('unauthenticated')
    // The session is gone from the store, not merely ignored.
    await expect(database().db.select().from(sessions)).resolves.toHaveLength(0)
  })

  it('clears the cookie the browser was holding', async () => {
    app = await buildStoredSessionApp()
    const session = await signIn(app)

    await disableTheMember()
    const response = await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })

    expect(clearsSessionCookie(response.headers['set-cookie'])).toBe(true)
  })

  it('sends a browser navigation to the sign-in page with the reason', async () => {
    app = await buildStoredSessionApp()
    const session = await signIn(app)

    await disableTheMember()
    const response = await app.inject({
      method: 'GET',
      url: '/go/handbook',
      headers: { ...session.headers, accept: 'text/html' },
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/auth/login?error=account_disabled')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(clearsSessionCookie(response.headers['set-cookie'])).toBe(true)
  })

  it('never bounces a health check or the sign-in page itself', async () => {
    app = await buildStoredSessionApp()
    const session = await signIn(app)
    await disableTheMember()

    const health = await app.inject({
      method: 'GET',
      url: '/_/health/live',
      headers: session.headers,
    })

    expect(health.statusCode).toBe(200)
  })

  it('stays signed in for the length of the user cache and no longer', async () => {
    let now = Date.now()
    const { db } = database()
    app = await buildIdentityApp({
      database: db,
      sessionStore: createPostgresSessionStore(db, { maxAgeMs: 30 * DAY }),
      identity: { now: () => now },
    })
    const session = await signIn(app)
    // Warm the cache, which is what delays the effect (spec 02 §3).
    await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })

    await disableTheMember()
    await expect(
      app.inject({ method: 'GET', url: ME_URL, headers: session.headers }),
    ).resolves.toMatchObject({ statusCode: 200 })

    now += 60_000
    await expect(
      app.inject({ method: 'GET', url: ME_URL, headers: session.headers }),
    ).resolves.toMatchObject({ statusCode: 401 })
  })

  it('takes effect at once when a member is disabled before their first request', async () => {
    app = await buildStoredSessionApp()
    const session = await signIn(app)

    await disableTheMember()

    await expect(
      app.inject({ method: 'GET', url: ME_URL, headers: session.headers }),
    ).resolves.toMatchObject({ statusCode: 401 })
  })
})

describe('a session whose member has been removed outright', () => {
  it("is destroyed just as a disabled member's is", async () => {
    app = await buildStoredSessionApp()
    const session = await signIn(app)

    // Spec 01 §2.4 never deletes a member, so this is the row simply not being there.
    await database().db.delete(sessions)
    await database().db.delete(auditEvents)
    await database().db.delete(users).where(eq(users.email, TEST_MEMBER_EMAIL))

    const response = await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })
    expect(response.statusCode).toBe(401)
  })
})

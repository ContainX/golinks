// The test sign-in endpoint (spec 02 §8).

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_TEST_TOKEN_LIFETIME_MS, TEST_LOGIN_PATH } from '../../src/auth/test-login.ts'
import { users } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  buildIdentityApp,
  mintTestLoginToken,
  readSessionCookie,
  signIn,
  TEST_MEMBER_EMAIL,
  type TestTokenOptions,
} from './sign-in.ts'

const database = useTestDatabase()
const WIDGETS = TEST_ORGANIZATION_IDS.widgets

let app: GoLinksApp | undefined

async function post(options: TestTokenOptions = {}) {
  const instance = app
  if (instance === undefined) throw new Error('The app was not built.')
  return instance.inject({
    method: 'POST',
    url: TEST_LOGIN_PATH,
    payload: { token: await mintTestLoginToken(options) },
  })
}

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('POST /_/auth/test-login', () => {
  it('answers 204 with a session cookie and creates the member', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await post()

    expect(response.statusCode).toBe(204)
    expect(readSessionCookie(response.headers['set-cookie'])).toBeDefined()

    const rows = await database().db.select().from(users)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      email: TEST_MEMBER_EMAIL,
      organizationId: WIDGETS,
      role: 'member',
    })
    expect(rows[0]?.lastLoginAt).toBeInstanceOf(Date)
  })

  it('runs the same role computation a real sign-in does', async () => {
    app = await buildIdentityApp({ database: database().db })

    await post({ groups: ['golinks-admins'], adminGroups: ['golinks-admins'] })

    const rows = await database().db.select().from(users).where(eq(users.email, TEST_MEMBER_EMAIL))
    expect(rows[0]).toMatchObject({ role: 'admin', roleSource: 'idp' })
  })

  it('refuses a token signed with another secret', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await post({ secret: 'a-completely-different-secret' })

    expect(response.statusCode).toBe(401)
    expect(response.json().error).toMatchObject({
      code: 'unauthenticated',
      details: { reason: 'token_invalid' },
    })
    expect(readSessionCookie(response.headers['set-cookie'])).toBeUndefined()
  })

  it('refuses an expired token', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await post({ expiresInMs: -10_000 })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.details).toEqual({ reason: 'token_expired' })
  })

  it('refuses a token that claims more than five minutes of life', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await post({ expiresInMs: MAX_TEST_TOKEN_LIFETIME_MS + 60_000 })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.details).toEqual({ reason: 'token_lifetime_too_long' })
  })

  it('refuses an address outside AUTH_TEST_DOMAINS', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await post({ email: 'someone@elsewhere.test' })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.details).toEqual({ reason: 'domain_not_allowed' })
    await expect(database().db.select().from(users)).resolves.toHaveLength(0)
  })

  it('refuses a disabled member with account_disabled (spec 01 §2.4)', async () => {
    const { db } = database()
    await insertOrganization(db, WIDGETS)
    await insertUser(db, { email: TEST_MEMBER_EMAIL, organizationId: WIDGETS, isEnabled: false })
    app = await buildIdentityApp({ database: db })

    const response = await post()

    expect(response.statusCode).toBe(403)
    expect(response.json().error.details).toEqual({ reason: 'account_disabled' })
    expect(readSessionCookie(response.headers['set-cookie'])).toBeUndefined()
  })

  it('refuses an organization outside ORG_ALLOWED_IDS', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: { ORG_ALLOWED_IDS: 'gizmos.test' },
    })

    const response = await post()

    expect(response.statusCode).toBe(403)
    expect(response.json().error.details).toEqual({ reason: 'org_not_allowed' })
  })
})

describe('GET /_/auth/test-login', () => {
  it('redirects to the sanitized path a browser test asked for', async () => {
    app = await buildIdentityApp({ database: database().db })
    const token = await mintTestLoginToken()

    const response = await app.inject({
      method: 'GET',
      url: `${TEST_LOGIN_PATH}?token=${encodeURIComponent(token)}&redirectTo=/go/handbook`,
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/go/handbook')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(readSessionCookie(response.headers['set-cookie'])).toBeDefined()
  })

  it('redirects to the directory when nothing usable was asked for', async () => {
    app = await buildIdentityApp({ database: database().db })
    const token = await mintTestLoginToken()

    const response = await app.inject({
      method: 'GET',
      url: `${TEST_LOGIN_PATH}?token=${encodeURIComponent(token)}&redirectTo=//evil.test/steal`,
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/')
  })

  it('refuses a bad token without opening a session', async () => {
    app = await buildIdentityApp({ database: database().db })
    const token = await mintTestLoginToken({ secret: 'a-completely-different-secret' })

    const response = await app.inject({
      method: 'GET',
      url: `${TEST_LOGIN_PATH}?token=${encodeURIComponent(token)}`,
    })

    expect(response.statusCode).toBe(401)
    expect(readSessionCookie(response.headers['set-cookie'])).toBeUndefined()
  })
})

describe('when test mode is off', () => {
  it('does not serve the endpoint at all', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: { AUTH_TEST_MODE: 'false' },
    })

    const posted = await post()
    const fetched = await app.inject({ method: 'GET', url: `${TEST_LOGIN_PATH}?token=x` })

    expect(posted.statusCode).toBe(404)
    expect(fetched.statusCode).toBe(404)
    await expect(database().db.select().from(users)).resolves.toHaveLength(0)
  })

  it('leaves the sign-in helper with nothing to sign in to', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: { AUTH_TEST_MODE: 'false' },
    })

    await expect(signIn(app)).rejects.toThrow(/404/)
  })
})

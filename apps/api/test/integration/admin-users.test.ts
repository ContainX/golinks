// The admin member endpoints (spec 01 §2.3-2.4, spec 05 §2.3 and §3).

import { AdminUserListResponseSchema, AdminUserSchema, API_BASE_PATH } from '@golinks/shared/api'
import { and, asc, eq } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../src/db/client.ts'
import { type AuditEventRow, auditEvents, type UserRow, users } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertLink, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { buildIdentityApp, type SignedInSession, signIn } from './sign-in.ts'

const database = useTestDatabase()
const USERS_URL = `${API_BASE_PATH}/admin/users`
const WIDGETS = TEST_ORGANIZATION_IDS.widgets
const GIZMOS = TEST_ORGANIZATION_IDS.gizmos
const ADMIN_GROUP = 'golinks-admins'
const ADMIN_EMAIL = `grace@${WIDGETS}`
const MEMBER_EMAIL = `ada@${WIDGETS}`
const OTHER_MEMBER_EMAIL = `linus@${WIDGETS}`

let app: GoLinksApp | undefined

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

/**
 * An instance with the identity foundation. The member cache is switched off unless a test is
 * about the cache itself, so a change made a moment ago is the one the next request sees.
 */
async function buildAdminApp(memberCacheTtlMs = 0): Promise<GoLinksApp> {
  app = await buildIdentityApp({ database: database().db, identity: { memberCacheTtlMs } })
  return app
}

/** Signs in through a group that confers the admin role (spec 01 §2.3). */
function signInAdmin(instance: GoLinksApp, email = ADMIN_EMAIL): Promise<SignedInSession> {
  return signIn(instance, { email, groups: [ADMIN_GROUP], adminGroups: [ADMIN_GROUP] })
}

async function readUser(db: Database, email: string): Promise<UserRow> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const row = rows[0]
  if (row === undefined) throw new Error(`No user row for ${email}.`)
  return row
}

async function userEvents(db: Database, userId: number): Promise<AuditEventRow[]> {
  return await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.objectType, 'user'), eq(auditEvents.objectId, String(userId))))
    .orderBy(asc(auditEvents.id))
}

function listUsers(
  instance: GoLinksApp,
  session: SignedInSession,
  query = '',
): Promise<LightMyRequestResponse> {
  return instance.inject({
    method: 'GET',
    url: `${USERS_URL}${query}`,
    headers: session.headers,
  })
}

describe('GET /admin/users', () => {
  it('lists the members of the caller organization with their link counts', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    await signIn(instance, { email: 'someone@gizmos.test' })
    const member = await readUser(database().db, MEMBER_EMAIL)
    for (const keyword of ['handbook', 'roadmap']) {
      await insertLink(database().db, { organizationId: WIDGETS, ownerId: member.id, keyword })
    }

    const response = await listUsers(instance, session)

    expect(response.statusCode).toBe(200)
    const body = AdminUserListResponseSchema.parse(response.json())
    expect(body.items.map((user) => user.email)).toEqual([MEMBER_EMAIL, ADMIN_EMAIL])
    expect(body.items[0]).toMatchObject({ linkCount: 2, role: 'member', roleSource: 'config' })
    expect(body.items[1]).toMatchObject({ linkCount: 0, role: 'admin', roleSource: 'idp' })
    expect(body.nextCursor).toBeNull()
  })

  it('counts only the links of the caller organization', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: 'someone@gizmos.test' })
    const neighbour = await readUser(database().db, 'someone@gizmos.test')
    await insertLink(database().db, {
      organizationId: GIZMOS,
      ownerId: neighbour.id,
      keyword: 'handbook',
    })

    const body = AdminUserListResponseSchema.parse((await listUsers(instance, session)).json())

    expect(body.items.map((user) => user.email)).toEqual([ADMIN_EMAIL])
  })

  it('matches the q filter against the email address, whatever its case', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })

    const body = AdminUserListResponseSchema.parse(
      (await listUsers(instance, session, '?q=ADA')).json(),
    )

    expect(body.items.map((user) => user.email)).toEqual([MEMBER_EMAIL])
  })

  it('filters by role', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })

    const body = AdminUserListResponseSchema.parse(
      (await listUsers(instance, session, '?role=admin')).json(),
    )

    expect(body.items.map((user) => user.email)).toEqual([ADMIN_EMAIL])
  })

  it('filters by whether the account is enabled', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    const member = await readUser(database().db, MEMBER_EMAIL)
    await database().db.update(users).set({ isEnabled: false }).where(eq(users.id, member.id))

    const disabled = AdminUserListResponseSchema.parse(
      (await listUsers(instance, session, '?enabled=false')).json(),
    )
    const enabled = AdminUserListResponseSchema.parse(
      (await listUsers(instance, session, '?enabled=true')).json(),
    )

    expect(disabled.items.map((user) => user.email)).toEqual([MEMBER_EMAIL])
    expect(enabled.items.map((user) => user.email)).toEqual([ADMIN_EMAIL])
  })

  it('pages through the members without repeating or skipping one', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    await signIn(instance, { email: OTHER_MEMBER_EMAIL })

    const first = AdminUserListResponseSchema.parse(
      (await listUsers(instance, session, '?limit=2')).json(),
    )
    expect(first.items.map((user) => user.email)).toEqual([MEMBER_EMAIL, ADMIN_EMAIL])
    expect(first.nextCursor).not.toBeNull()

    const second = AdminUserListResponseSchema.parse(
      (
        await listUsers(
          instance,
          session,
          `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
        )
      ).json(),
    )
    expect(second.items.map((user) => user.email)).toEqual([OTHER_MEMBER_EMAIL])
    expect(second.nextCursor).toBeNull()
  })

  it('rejects a cursor that did not come from the previous page', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await listUsers(instance, session, '?cursor=not-a-cursor')

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('rejects a query parameter it does not know', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await listUsers(instance, session, '?sort=email')

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('refuses a member and a caller with no session', async () => {
    const instance = await buildAdminApp()
    const member = await signIn(instance, { email: MEMBER_EMAIL })

    expect((await listUsers(instance, member)).statusCode).toBe(403)
    expect((await instance.inject({ method: 'GET', url: USERS_URL })).statusCode).toBe(401)
  })
})

describe('GET /admin/users/:id', () => {
  it('answers with the member the id names', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    const member = await readUser(database().db, MEMBER_EMAIL)
    await insertLink(database().db, {
      organizationId: WIDGETS,
      ownerId: member.id,
      keyword: 'handbook',
    })

    const response = await instance.inject({
      method: 'GET',
      url: `${USERS_URL}/${member.id}`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(200)
    expect(AdminUserSchema.parse(response.json())).toMatchObject({
      id: String(member.id),
      email: MEMBER_EMAIL,
      isEnabled: true,
      linkCount: 1,
    })
  })

  it('answers 404 for a member of another organization', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: 'someone@gizmos.test' })
    const neighbour = await readUser(database().db, 'someone@gizmos.test')

    const response = await instance.inject({
      method: 'GET',
      url: `${USERS_URL}/${neighbour.id}`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('answers 404 for an id that is not one', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await instance.inject({
      method: 'GET',
      url: `${USERS_URL}/not-a-number`,
      headers: session.headers,
    })

    expect(response.statusCode).toBe(404)
  })
})

describe('PATCH /admin/users/:id', () => {
  function patchUser(
    instance: GoLinksApp,
    session: SignedInSession,
    id: number | string,
    body: object,
  ): Promise<LightMyRequestResponse> {
    return instance.inject({
      method: 'PATCH',
      url: `${USERS_URL}/${id}`,
      headers: session.apiHeaders,
      payload: body,
    })
  }

  it('disables a member and records the change', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    const member = await readUser(database().db, MEMBER_EMAIL)
    const admin = await readUser(database().db, ADMIN_EMAIL)

    const response = await patchUser(instance, session, member.id, { isEnabled: false })

    expect(response.statusCode).toBe(200)
    expect(AdminUserSchema.parse(response.json()).isEnabled).toBe(false)
    expect((await readUser(database().db, MEMBER_EMAIL)).isEnabled).toBe(false)

    const events = await userEvents(database().db, member.id)
    const updates = events.filter((event) => event.type === 'user.updated')
    expect(updates).toHaveLength(1)
    expect(updates[0]?.actorUserId).toBe(admin.id)
    expect(updates[0]?.data).toEqual({ changes: { isEnabled: [true, false] } })
  })

  it('takes effect on the disabled member next request (spec 01 §2.4)', async () => {
    // The default member cache would otherwise answer from a copy of the row for a minute.
    const instance = await buildAdminApp(60_000)
    const session = await signInAdmin(instance)
    const memberSession = await signIn(instance, { email: MEMBER_EMAIL })
    const member = await readUser(database().db, MEMBER_EMAIL)

    const before = await instance.inject({
      method: 'GET',
      url: `${API_BASE_PATH}/me`,
      headers: memberSession.headers,
    })
    expect(before.statusCode).toBe(200)

    await patchUser(instance, session, member.id, { isEnabled: false })

    const after = await instance.inject({
      method: 'GET',
      url: `${API_BASE_PATH}/me`,
      headers: memberSession.headers,
    })
    expect(after.statusCode).toBe(401)
  })

  it('makes a role set by hand survive the next sign-in (spec 01 §2.3)', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    const member = await readUser(database().db, MEMBER_EMAIL)

    const response = await patchUser(instance, session, member.id, { role: 'admin' })

    expect(response.statusCode).toBe(200)
    expect(AdminUserSchema.parse(response.json())).toMatchObject({
      role: 'admin',
      roleSource: 'manual',
    })

    // Signing in again recomputes nothing: the manual decision stands.
    await signIn(instance, { email: MEMBER_EMAIL })
    expect(await readUser(database().db, MEMBER_EMAIL)).toMatchObject({
      role: 'admin',
      roleSource: 'manual',
    })
  })

  it('refuses an admin acting on themselves (spec 01 §2.3)', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)

    const disable = await patchUser(instance, session, admin.id, { isEnabled: false })
    const demote = await patchUser(instance, session, admin.id, { role: 'member' })

    expect(disable.statusCode).toBe(400)
    expect(disable.json().error.code).toBe('cannot_modify_self')
    expect(demote.json().error.code).toBe('cannot_modify_self')
    expect(await readUser(database().db, ADMIN_EMAIL)).toMatchObject({
      role: 'admin',
      isEnabled: true,
    })
  })

  it('writes nothing when the change asks for what is already stored', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    const member = await readUser(database().db, MEMBER_EMAIL)

    const response = await patchUser(instance, session, member.id, {
      role: 'member',
      isEnabled: true,
    })

    expect(response.statusCode).toBe(200)
    const updates = (await userEvents(database().db, member.id)).filter(
      (event) => event.type === 'user.updated',
    )
    expect(updates).toEqual([])
    expect((await readUser(database().db, MEMBER_EMAIL)).roleSource).toBe('config')
  })

  it('answers 404 for a member of another organization', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: 'someone@gizmos.test' })
    const neighbour = await readUser(database().db, 'someone@gizmos.test')

    const response = await patchUser(instance, session, neighbour.id, { isEnabled: false })

    expect(response.statusCode).toBe(404)
    expect((await readUser(database().db, 'someone@gizmos.test')).isEnabled).toBe(true)
  })

  it('rejects a body that changes nothing at all', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    const member = await readUser(database().db, MEMBER_EMAIL)

    const response = await patchUser(instance, session, member.id, {})

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('refuses a member and a caller with no session', async () => {
    const instance = await buildAdminApp()
    const memberSession = await signIn(instance, { email: MEMBER_EMAIL })
    await signIn(instance, { email: OTHER_MEMBER_EMAIL })
    const other = await readUser(database().db, OTHER_MEMBER_EMAIL)

    const forbidden = await patchUser(instance, memberSession, other.id, { isEnabled: false })
    const unauthenticated = await instance.inject({
      method: 'PATCH',
      url: `${USERS_URL}/${other.id}`,
      headers: { origin: instance.appConfig.baseUrl, 'content-type': 'application/json' },
      payload: { isEnabled: false },
    })

    expect(forbidden.statusCode).toBe(403)
    expect(unauthenticated.statusCode).toBe(401)
  })
})

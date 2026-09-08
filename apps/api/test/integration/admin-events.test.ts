// `GET /_/api/v1/admin/events`: the admin's window on the audit trail (spec 07 §1.2).

import type { AuditEventType } from '@golinks/shared/api'
import { API_BASE_PATH, AuditEventListResponseSchema } from '@golinks/shared/api'
import { eq } from 'drizzle-orm'
import type { LightMyRequestResponse } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../src/db/client.ts'
import { auditEvents, type UserRow, users } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { buildIdentityApp, type SignedInSession, signIn } from './sign-in.ts'

const database = useTestDatabase()
const EVENTS_URL = `${API_BASE_PATH}/admin/events`
const WIDGETS = TEST_ORGANIZATION_IDS.widgets
const GIZMOS = TEST_ORGANIZATION_IDS.gizmos
const ADMIN_GROUP = 'golinks-admins'
const ADMIN_EMAIL = `grace@${WIDGETS}`
const MEMBER_EMAIL = `ada@${WIDGETS}`

/** A fixed moment, so a test can say which event is newer without waiting for the clock. */
const NOON = Date.parse('2026-09-07T12:00:00.000Z')

let app: GoLinksApp | undefined

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

async function buildAdminApp(): Promise<GoLinksApp> {
  app = await buildIdentityApp({ database: database().db, identity: { memberCacheTtlMs: 0 } })
  return app
}

function signInAdmin(instance: GoLinksApp, email = ADMIN_EMAIL): Promise<SignedInSession> {
  return signIn(instance, { email, groups: [ADMIN_GROUP], adminGroups: [ADMIN_GROUP] })
}

async function readUser(db: Database, email: string): Promise<UserRow> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1)
  const row = rows[0]
  if (row === undefined) throw new Error(`No user row for ${email}.`)
  return row
}

/**
 * Empties the trail, so a test says exactly what is in it. Signing a member in writes a
 * `user.created` event of its own (spec 01 §2.2), and these tests are about the feed rather
 * than about what sign-in leaves behind.
 */
async function clearTrail(db: Database): Promise<void> {
  await db.delete(auditEvents)
}

interface EventFixture {
  organizationId?: string
  type?: AuditEventType
  actorUserId?: number | null
  objectType?: 'link' | 'user' | 'organization' | 'transfer'
  objectId?: string | number
  data?: Record<string, unknown>
  requestId?: string | null
  /** Milliseconds after `NOON`, so a suite can order rows exactly. */
  at?: number
}

/**
 * Appends one row straight to the trail. Written by hand rather than through a mutation so
 * that a test can choose the timestamp two events share and watch the tiebreak work.
 */
async function record(db: Database, fixture: EventFixture = {}): Promise<void> {
  await db.insert(auditEvents).values({
    organizationId: fixture.organizationId ?? WIDGETS,
    type: fixture.type ?? 'link.created',
    actorUserId: fixture.actorUserId ?? null,
    objectType: fixture.objectType ?? 'link',
    objectId: String(fixture.objectId ?? 1),
    data: fixture.data ?? {},
    requestId: fixture.requestId ?? null,
    createdAt: new Date(NOON + (fixture.at ?? 0)),
  })
}

function readEvents(
  instance: GoLinksApp,
  session: SignedInSession,
  query = '',
): Promise<LightMyRequestResponse> {
  return instance.inject({
    method: 'GET',
    url: `${EVENTS_URL}${query}`,
    headers: session.headers,
  })
}

describe('GET /admin/events', () => {
  it('answers newest first, in the shape the shared schema defines', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    const admin = await readUser(database().db, ADMIN_EMAIL)
    await clearTrail(database().db)
    await record(database().db, {
      type: 'link.created',
      objectId: 1,
      actorUserId: admin.id,
      requestId: 'req-1',
      data: { keyword: 'handbook' },
      at: 0,
    })
    await record(database().db, { type: 'link.deleted', objectId: 1, at: 1_000 })

    const response = await readEvents(instance, session)

    expect(response.statusCode).toBe(200)
    const body = AuditEventListResponseSchema.parse(response.json())
    expect(body.items.map((event) => event.type)).toEqual(['link.deleted', 'link.created'])
    expect(body.items[1]).toMatchObject({
      actorUserId: String(admin.id),
      objectType: 'link',
      objectId: '1',
      requestId: 'req-1',
      data: { keyword: 'handbook' },
    })
    // A system action has no actor (spec 07 §1).
    expect(body.items[0]?.actorUserId).toBeNull()
    expect(body.nextCursor).toBeNull()
  })

  it('never shows the trail of another organization', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await clearTrail(database().db)
    await record(database().db, { objectId: 1 })
    await record(database().db, { organizationId: GIZMOS, objectId: 2 })

    const body = AuditEventListResponseSchema.parse((await readEvents(instance, session)).json())

    expect(body.items.map((event) => event.objectId)).toEqual(['1'])
  })

  it('filters by event type', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await clearTrail(database().db)
    await record(database().db, { type: 'link.created', objectId: 1 })
    await record(database().db, { type: 'link.deleted', objectId: 2, at: 1_000 })

    const body = AuditEventListResponseSchema.parse(
      (await readEvents(instance, session, '?type=link.created')).json(),
    )

    expect(body.items.map((event) => event.objectId)).toEqual(['1'])
  })

  it('filters by link, which is the history of that one link', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await clearTrail(database().db)
    await record(database().db, { objectType: 'link', objectId: 7, type: 'link.created' })
    await record(database().db, { objectType: 'link', objectId: 7, type: 'link.updated', at: 1 })
    await record(database().db, { objectType: 'link', objectId: 8, at: 2 })
    // Same id, another kind of object: the filter is not fooled by the number alone.
    await record(database().db, { objectType: 'user', objectId: 7, type: 'user.created', at: 3 })

    const body = AuditEventListResponseSchema.parse(
      (await readEvents(instance, session, '?linkId=7')).json(),
    )

    expect(body.items.map((event) => event.type)).toEqual(['link.updated', 'link.created'])
  })

  it('filters by member: what they caused and what was done to them', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await signIn(instance, { email: MEMBER_EMAIL })
    const admin = await readUser(database().db, ADMIN_EMAIL)
    const member = await readUser(database().db, MEMBER_EMAIL)
    await clearTrail(database().db)

    await record(database().db, {
      type: 'user.updated',
      objectType: 'user',
      objectId: member.id,
      actorUserId: admin.id,
      at: 0,
    })
    await record(database().db, {
      type: 'link.created',
      objectType: 'link',
      objectId: 3,
      actorUserId: member.id,
      at: 1_000,
    })
    await record(database().db, { type: 'link.created', objectId: 4, actorUserId: admin.id, at: 2 })

    const body = AuditEventListResponseSchema.parse(
      (await readEvents(instance, session, `?userId=${member.id}`)).json(),
    )

    expect(body.items.map((event) => event.type)).toEqual(['link.created', 'user.updated'])
  })

  it('pages newest first, breaking a tie on the row id', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await clearTrail(database().db)
    // Three events at the same instant: only the id can order them.
    for (const objectId of [1, 2, 3]) await record(database().db, { objectId })

    const first = AuditEventListResponseSchema.parse(
      (await readEvents(instance, session, '?limit=2')).json(),
    )
    expect(first.items.map((event) => event.objectId)).toEqual(['3', '2'])
    expect(first.nextCursor).not.toBeNull()

    const second = AuditEventListResponseSchema.parse(
      (
        await readEvents(
          instance,
          session,
          `?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
        )
      ).json(),
    )
    expect(second.items.map((event) => event.objectId)).toEqual(['1'])
    expect(second.nextCursor).toBeNull()
  })

  it('keeps the filter while paging', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)
    await clearTrail(database().db)
    await record(database().db, { type: 'link.created', objectId: 1, at: 0 })
    await record(database().db, { type: 'link.deleted', objectId: 2, at: 1_000 })
    await record(database().db, { type: 'link.created', objectId: 3, at: 2_000 })

    const first = AuditEventListResponseSchema.parse(
      (await readEvents(instance, session, '?type=link.created&limit=1')).json(),
    )
    const second = AuditEventListResponseSchema.parse(
      (
        await readEvents(
          instance,
          session,
          `?type=link.created&limit=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`,
        )
      ).json(),
    )

    expect(first.items.map((event) => event.objectId)).toEqual(['3'])
    expect(second.items.map((event) => event.objectId)).toEqual(['1'])
    expect(second.nextCursor).toBeNull()
  })

  it('rejects a cursor that did not come from the previous page', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await readEvents(instance, session, '?cursor=not-a-cursor')

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('rejects a type it does not know', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    const response = await readEvents(instance, session, '?type=link.renamed')

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('validation_failed')
  })

  it('refuses a member and a caller with no session', async () => {
    const instance = await buildAdminApp()
    const member = await signIn(instance, { email: MEMBER_EMAIL })

    const forbidden = await readEvents(instance, member)
    const unauthenticated = await instance.inject({ method: 'GET', url: EVENTS_URL })

    expect(forbidden.statusCode).toBe(403)
    expect(forbidden.json().error.code).toBe('forbidden')
    expect(unauthenticated.statusCode).toBe(401)
  })

  it('shows the events the admin endpoints themselves wrote', async () => {
    const instance = await buildAdminApp()
    const session = await signInAdmin(instance)

    await instance.inject({
      method: 'PUT',
      url: `${API_BASE_PATH}/admin/settings`,
      headers: session.apiHeaders,
      payload: { readOnly: true },
    })

    const body = AuditEventListResponseSchema.parse(
      (await readEvents(instance, session, '?type=organization.settings_updated')).json(),
    )

    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      objectType: 'organization',
      objectId: WIDGETS,
      data: { changes: { readOnly: [false, true] } },
    })
    expect(body.items[0]?.requestId).not.toBeNull()
  })
})

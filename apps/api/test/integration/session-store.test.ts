// The two production session stores against their real backing services (spec 02 §3).
//
// The Postgres store is covered in full. The Redis store runs against a Redis when one is
// reachable — GOLINKS_TEST_REDIS_URL, or a local default — and is skipped otherwise, so the
// suite needs nothing installed to pass.

import type { Session } from 'fastify'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createPostgresSessionStore,
  createRedisSessionStore,
  type PostgresSessionStore,
  SESSION_KEY_PREFIX,
  type SessionRedisClient,
} from '../../src/auth/session-stores.ts'
import { type SessionRow, sessions } from '../../src/db/schema/index.ts'
import { insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()
const WIDGETS = TEST_ORGANIZATION_IDS.widgets
const DAY = 24 * 60 * 60 * 1000
const SIGNED_IN_AT = Date.parse('2026-09-07T12:00:00.000Z')

interface AnySessionStore {
  get(id: string, callback: (error: unknown, session?: Session | null) => void): void
  set(id: string, session: Session, callback: (error?: unknown) => void): void
  destroy(id: string, callback: (error?: unknown) => void): void
}

function read(store: AnySessionStore, id: string): Promise<Session | null | undefined> {
  return new Promise((resolve, reject) => {
    store.get(id, (error, session) => (error ? reject(error) : resolve(session)))
  })
}

function write(store: AnySessionStore, id: string, session: Session): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(id, session, (error) => (error ? reject(error) : resolve()))
  })
}

function remove(store: AnySessionStore, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    store.destroy(id, (error) => (error ? reject(error) : resolve()))
  })
}

function sessionFor(userId: number, signedInAt = SIGNED_IN_AT): Session {
  return {
    userId: String(userId),
    providerId: 'okta',
    createdAt: new Date(signedInAt).toISOString(),
    lastSeenAt: new Date(signedInAt).toISOString(),
  } as unknown as Session
}

describe('the Postgres session store', () => {
  let memberId = 0
  let now = SIGNED_IN_AT

  async function seedMember(): Promise<number> {
    const { db } = database()
    await insertOrganization(db, WIDGETS)
    const member = await insertUser(db, { email: 'ada@widgets.test', organizationId: WIDGETS })
    return member.id
  }

  function store(idleTimeoutMs?: number): PostgresSessionStore {
    return createPostgresSessionStore(database().db, {
      maxAgeMs: 30 * DAY,
      ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
      now: () => now,
    })
  }

  async function rows(): Promise<SessionRow[]> {
    return database().db.select().from(sessions)
  }

  beforeEach(async () => {
    await resetDatabase()
    now = SIGNED_IN_AT
    memberId = await seedMember()
  })

  it('writes one row per session, hung off the member who signed in', async () => {
    await write(store(), 'abc', sessionFor(memberId))

    const stored = await rows()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ id: 'abc', userId: memberId })
    expect(stored[0]?.data).toMatchObject({ userId: memberId, providerId: 'okta' })
    expect(stored[0]?.expiresAt.getTime()).toBe(SIGNED_IN_AT + 30 * DAY)
  })

  it('reads a session back with the fields the sign-in put in it', async () => {
    await write(store(), 'abc', sessionFor(memberId))

    await expect(read(store(), 'abc')).resolves.toMatchObject({
      userId: String(memberId),
      providerId: 'okta',
      createdAt: new Date(SIGNED_IN_AT).toISOString(),
    })
  })

  it('reads an unknown session as nothing at all', async () => {
    await expect(read(store(), 'missing')).resolves.toBeNull()
  })

  it('keeps nothing for a session nobody has signed in to', async () => {
    await write(store(), 'abc', {} as Session)
    await expect(rows()).resolves.toHaveLength(0)
  })

  it('refreshes last-seen on every save without moving the absolute ceiling', async () => {
    await write(store(), 'abc', sessionFor(memberId))

    now = SIGNED_IN_AT + 5 * DAY
    const restored = await read(store(), 'abc')
    await write(store(), 'abc', restored as Session)

    const stored = await rows()
    expect(stored).toHaveLength(1)
    expect(stored[0]?.lastSeenAt.getTime()).toBe(SIGNED_IN_AT + 5 * DAY)
    // Sign-in plus SESSION_MAX_AGE, however often the member comes back (spec 02 §3).
    expect(stored[0]?.expiresAt.getTime()).toBe(SIGNED_IN_AT + 30 * DAY)
  })

  it('forgets a session that has outlived the absolute maximum, and drops its row', async () => {
    await write(store(), 'abc', sessionFor(memberId))

    now = SIGNED_IN_AT + 30 * DAY
    await expect(read(store(), 'abc')).resolves.toBeNull()
    await expect(rows()).resolves.toHaveLength(0)
  })

  it('forgets an idle session once the idle timeout has passed', async () => {
    await write(store(60_000), 'abc', sessionFor(memberId))

    now = SIGNED_IN_AT + 59_000
    await expect(read(store(60_000), 'abc')).resolves.not.toBeNull()

    now = SIGNED_IN_AT + 60_000
    await expect(read(store(60_000), 'abc')).resolves.toBeNull()
    await expect(rows()).resolves.toHaveLength(0)
  })

  it('keeps an idle session alive when no idle timeout is configured', async () => {
    await write(store(), 'abc', sessionFor(memberId))

    now = SIGNED_IN_AT + 29 * DAY
    await expect(read(store(), 'abc')).resolves.not.toBeNull()
  })

  it('destroys a session on request', async () => {
    await write(store(), 'abc', sessionFor(memberId))

    await remove(store(), 'abc')

    await expect(rows()).resolves.toHaveLength(0)
    await expect(read(store(), 'abc')).resolves.toBeNull()
  })

  it('sweeps away every row whose absolute lifetime has run out', async () => {
    await write(store(), 'old', sessionFor(memberId, SIGNED_IN_AT - 31 * DAY))
    await write(store(), 'new', sessionFor(memberId))

    await expect(store().sweepExpired()).resolves.toBe(1)
    const remaining = await rows()
    expect(remaining.map((row) => row.id)).toEqual(['new'])
  })
})

/** A Redis to run the store against, or undefined when none is reachable. */
async function openRedis(): Promise<SessionRedisClient | undefined> {
  const url = process.env.GOLINKS_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379'
  const { Redis } = await import('ioredis')
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 300,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  })
  client.on('error', () => {})
  try {
    await client.connect()
    await client.ping()
    return client as unknown as SessionRedisClient & { quit(): Promise<unknown> }
  } catch {
    client.disconnect()
    return undefined
  }
}

const redis = await openRedis()

afterAll(async () => {
  await (redis as { quit?: () => Promise<unknown> } | undefined)?.quit?.().catch(() => {})
})

describe.skipIf(redis === undefined)('the Redis session store', () => {
  const client = redis as SessionRedisClient
  let now = SIGNED_IN_AT
  const key = `${SESSION_KEY_PREFIX}integration-abc`

  function store(idleTimeoutMs?: number) {
    return createRedisSessionStore(client, {
      maxAgeMs: 30 * DAY,
      ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
      now: () => now,
    })
  }

  beforeEach(async () => {
    now = SIGNED_IN_AT
    await client.del(key)
  })

  it('round-trips a session under the session:<id> key', async () => {
    await write(store(), 'integration-abc', sessionFor(7))

    await expect(client.get(key)).resolves.toContain('"providerId":"okta"')
    await expect(read(store(), 'integration-abc')).resolves.toMatchObject({
      userId: '7',
      providerId: 'okta',
    })
  })

  it('forgets a session that has outlived the absolute maximum', async () => {
    await write(store(), 'integration-abc', sessionFor(7))

    now = SIGNED_IN_AT + 30 * DAY
    await expect(read(store(), 'integration-abc')).resolves.toBeNull()
    await expect(client.get(key)).resolves.toBeNull()
  })

  it('forgets an idle session once the idle timeout has passed', async () => {
    await write(store(60_000), 'integration-abc', sessionFor(7))

    now = SIGNED_IN_AT + 60_000
    await expect(read(store(60_000), 'integration-abc')).resolves.toBeNull()
  })

  it('keeps nothing for a session nobody has signed in to', async () => {
    await write(store(), 'integration-abc', {} as Session)
    await expect(client.get(key)).resolves.toBeNull()
  })

  it('destroys a session on request', async () => {
    await write(store(), 'integration-abc', sessionFor(7))

    await remove(store(), 'integration-abc')

    await expect(client.get(key)).resolves.toBeNull()
  })
})

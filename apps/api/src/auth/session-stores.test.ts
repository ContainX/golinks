import type { Session } from 'fastify'
import { describe, expect, it } from 'vitest'
import type { SessionData } from '../db/schema/index.ts'
import {
  absoluteExpiryOf,
  createRedisSessionStore,
  fromSessionRecord,
  isSessionExpired,
  SESSION_KEY_PREFIX,
  type SessionRedisClient,
  toSessionRecord,
} from './session-stores.ts'

const SIGNED_IN_AT = Date.parse('2026-09-07T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

function sessionWith(fields: Record<string, unknown>): Session {
  return fields as unknown as Session
}

function record(overrides: Partial<SessionData> = {}): SessionData {
  return {
    userId: 7,
    providerId: 'okta',
    createdAt: new Date(SIGNED_IN_AT).toISOString(),
    lastSeenAt: new Date(SIGNED_IN_AT).toISOString(),
    ...overrides,
  }
}

/** A Redis stand-in that remembers the last TTL it was given. */
function fakeRedis(): SessionRedisClient & { entries: Map<string, string>; ttls: number[] } {
  const entries = new Map<string, string>()
  const ttls: number[] = []
  return {
    entries,
    ttls,
    async get(key) {
      return entries.get(key) ?? null
    },
    async set(key, value, _mode, ttlMs) {
      ttls.push(ttlMs)
      entries.set(key, value)
    },
    async del(key) {
      entries.delete(key)
    },
  }
}

function get(store: ReturnType<typeof createRedisSessionStore>, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    store.get(id, (error, session) => (error ? reject(error) : resolve(session)))
  })
}

function set(
  store: ReturnType<typeof createRedisSessionStore>,
  id: string,
  session: Session,
): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(id, session, (error) => (error ? reject(error) : resolve()))
  })
}

describe('the session record', () => {
  it('keeps nothing for a session nobody has signed in to', () => {
    expect(toSessionRecord(sessionWith({}), SIGNED_IN_AT)).toBeNull()
    expect(toSessionRecord(sessionWith({ userId: 'not-a-number' }), SIGNED_IN_AT)).toBeNull()
  })

  it('stamps last-seen on every write and keeps the sign-in time', () => {
    const written = toSessionRecord(
      sessionWith({
        userId: '7',
        providerId: 'okta',
        createdAt: new Date(SIGNED_IN_AT).toISOString(),
        lastSeenAt: new Date(SIGNED_IN_AT).toISOString(),
      }),
      SIGNED_IN_AT + 5_000,
    )

    expect(written).toEqual({
      userId: 7,
      providerId: 'okta',
      createdAt: new Date(SIGNED_IN_AT).toISOString(),
      lastSeenAt: new Date(SIGNED_IN_AT + 5_000).toISOString(),
    })
  })

  it('carries the id token only when one was kept for sign-out', () => {
    const withToken = toSessionRecord(
      sessionWith({ userId: '7', providerId: 'okta', idToken: 'header.body.signature' }),
      SIGNED_IN_AT,
    )
    expect(withToken?.idToken).toBe('header.body.signature')
    expect(fromSessionRecord(record()).idToken).toBeUndefined()
  })

  it('restores the session without a cookie, so the configured expiry applies again', () => {
    expect(fromSessionRecord(record())).toEqual({
      userId: '7',
      providerId: 'okta',
      createdAt: new Date(SIGNED_IN_AT).toISOString(),
      lastSeenAt: new Date(SIGNED_IN_AT).toISOString(),
    })
  })
})

describe('session lifetimes', () => {
  it('measures the absolute ceiling from sign-in', () => {
    expect(absoluteExpiryOf(record(), { maxAgeMs: 30 * DAY })).toBe(SIGNED_IN_AT + 30 * DAY)
  })

  it('expires a session that has outlived the absolute maximum however active it was', () => {
    const active = record({ lastSeenAt: new Date(SIGNED_IN_AT + 30 * DAY).toISOString() })
    expect(isSessionExpired(active, SIGNED_IN_AT + 30 * DAY, { maxAgeMs: 30 * DAY })).toBe(true)
    expect(isSessionExpired(active, SIGNED_IN_AT + 29 * DAY, { maxAgeMs: 30 * DAY })).toBe(false)
  })

  it('expires an idle session before the absolute maximum when a timeout is configured', () => {
    const lifetime = { maxAgeMs: 30 * DAY, idleTimeoutMs: 60_000 }
    expect(isSessionExpired(record(), SIGNED_IN_AT + 59_000, lifetime)).toBe(false)
    expect(isSessionExpired(record(), SIGNED_IN_AT + 60_000, lifetime)).toBe(true)
  })

  it('leaves idle sessions alone when no timeout is configured', () => {
    expect(isSessionExpired(record(), SIGNED_IN_AT + 29 * DAY, { maxAgeMs: 30 * DAY })).toBe(false)
  })
})

describe('the Redis session store', () => {
  const lifetime = { maxAgeMs: 30 * DAY }

  it('keys a session as session:<id> and reads it back', async () => {
    const redis = fakeRedis()
    let now = SIGNED_IN_AT
    const store = createRedisSessionStore(redis, { ...lifetime, now: () => now })

    await set(store, 'abc', sessionWith({ userId: '7', providerId: 'okta' }))
    expect([...redis.entries.keys()]).toEqual([`${SESSION_KEY_PREFIX}abc`])

    now += 1_000
    expect(await get(store, 'abc')).toMatchObject({ userId: '7', providerId: 'okta' })
  })

  it('lets the key live for whichever lifetime runs out first', async () => {
    const redis = fakeRedis()
    const store = createRedisSessionStore(redis, {
      maxAgeMs: 30 * DAY,
      idleTimeoutMs: 60_000,
      now: () => SIGNED_IN_AT,
    })

    await set(store, 'abc', sessionWith({ userId: '7', providerId: 'okta' }))
    expect(redis.ttls).toEqual([60_000])
  })

  it('writes nothing for an anonymous session', async () => {
    const redis = fakeRedis()
    const store = createRedisSessionStore(redis, lifetime)

    await set(store, 'abc', sessionWith({}))
    expect(redis.entries.size).toBe(0)
  })

  it('drops a session that has outlived its absolute maximum', async () => {
    const redis = fakeRedis()
    let now = SIGNED_IN_AT
    const store = createRedisSessionStore(redis, { ...lifetime, now: () => now })

    await set(store, 'abc', sessionWith({ userId: '7', providerId: 'okta' }))
    now += 30 * DAY

    expect(await get(store, 'abc')).toBeNull()
    expect(redis.entries.size).toBe(0)
  })

  it('reads a corrupted value as no session at all', async () => {
    const redis = fakeRedis()
    redis.entries.set(`${SESSION_KEY_PREFIX}abc`, 'not json')
    const store = createRedisSessionStore(redis, lifetime)

    expect(await get(store, 'abc')).toBeNull()
    expect(redis.entries.size).toBe(0)
  })

  it('destroys a session on request', async () => {
    const redis = fakeRedis()
    const store = createRedisSessionStore(redis, lifetime)
    await set(store, 'abc', sessionWith({ userId: '7', providerId: 'okta' }))

    await new Promise<void>((resolve, reject) => {
      store.destroy('abc', (error) => (error ? reject(error) : resolve()))
    })
    expect(redis.entries.size).toBe(0)
  })
})

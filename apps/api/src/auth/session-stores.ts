// Server-side session stores (spec 02 §3).
//
// A session lives in Redis when REDIS_URL is set and in the Postgres `sessions` table
// otherwise. Both stores hold the same record, enforce the same two lifetimes — the absolute
// maximum measured from sign-in and the optional idle timeout — and hand @fastify/session back
// a plain object. Neither store knows anything about cookies; that policy lives in
// `security/session.ts`, which re-exports these factories.

import type { SessionStore } from '@fastify/session'
import type { DeploymentConfig } from '@golinks/shared/config'
import { eq, lte } from 'drizzle-orm'
import type { Session } from 'fastify'
import type { Database } from '../db/client.ts'
import { type SessionData, sessions } from '../db/schema/index.ts'

/** Every session key in Redis is `session:<id>` (spec 02 §3). */
export const SESSION_KEY_PREFIX = 'session:'

/** The two lifetimes a session is held to (spec 02 §3). */
export interface SessionLifetime {
  /** Absolute ceiling measured from sign-in, from SESSION_MAX_AGE. */
  maxAgeMs: number
  /** Idle ceiling measured from the last request, from SESSION_IDLE_TIMEOUT. Off when absent. */
  idleTimeoutMs?: number | undefined
}

export interface SessionStoreOptions extends SessionLifetime {
  /** Clock, injectable so a lifetime test does not have to wait out a real timeout. */
  now?: () => number
}

/** The lifetimes a deployment configuration asks for. */
export function sessionLifetimeOf(config: DeploymentConfig): SessionLifetime {
  return { maxAgeMs: config.session.maxAgeMs, idleTimeoutMs: config.session.idleTimeoutMs }
}

// --- the record both stores hold --------------------------------------------

function readableString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readableTimestamp(value: unknown, fallback: string): string {
  const text = readableString(value)
  if (text === undefined || Number.isNaN(Date.parse(text))) return fallback
  return text
}

/**
 * Turns a live session into the row or Redis value that represents it, or `null` when nobody
 * is signed in yet. An anonymous session carries nothing worth keeping and has no `user_id`
 * to satisfy the table, so it is never written.
 */
export function toSessionRecord(session: Session, nowMs: number): SessionData | null {
  const userId = Number(session.userId)
  if (!Number.isInteger(userId) || userId <= 0) return null

  const nowIso = new Date(nowMs).toISOString()
  const record: SessionData = {
    userId,
    providerId: readableString(session.providerId) ?? 'unknown',
    createdAt: readableTimestamp(session.createdAt, nowIso),
    // Refreshed on every save; the idle timeout is measured from it.
    lastSeenAt: nowIso,
  }
  const idToken = readableString(session.idToken)
  if (idToken !== undefined) record.idToken = idToken
  return record
}

/**
 * Rebuilds the session @fastify/session restores from. No cookie is stored with the record,
 * so the plugin applies the configured cookie options and the expiry slides on its own.
 */
export function fromSessionRecord(record: SessionData): Session {
  const session: Record<string, unknown> = {
    userId: String(record.userId),
    providerId: record.providerId,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
  }
  if (record.idToken !== undefined) session.idToken = record.idToken
  return session as unknown as Session
}

/** Sign-in time plus the absolute maximum: the moment the session dies whatever it does. */
export function absoluteExpiryOf(record: SessionData, lifetime: SessionLifetime): number {
  const createdAt = Date.parse(record.createdAt)
  return (Number.isNaN(createdAt) ? Date.now() : createdAt) + lifetime.maxAgeMs
}

/** Whether the record has outlived either of its two lifetimes. */
export function isSessionExpired(
  record: SessionData,
  nowMs: number,
  lifetime: SessionLifetime,
): boolean {
  if (absoluteExpiryOf(record, lifetime) <= nowMs) return true
  const idle = lifetime.idleTimeoutMs
  if (idle === undefined) return false
  const lastSeenAt = Date.parse(record.lastSeenAt)
  return !Number.isNaN(lastSeenAt) && lastSeenAt + idle <= nowMs
}

// --- Postgres ---------------------------------------------------------------

export interface PostgresSessionStore extends SessionStore {
  /** Removes every row whose absolute lifetime has run out. Returns how many went. */
  sweepExpired(): Promise<number>
}

/**
 * The default store: one row per session in `sessions` (spec 02 §3). Correct for a single
 * replica and for any deployment that would rather not run a Redis; Redis is the better
 * choice once more than one replica serves traffic.
 */
export function createPostgresSessionStore(
  db: Database,
  options: SessionStoreOptions,
): PostgresSessionStore {
  const now = options.now ?? Date.now
  const lifetime: SessionLifetime = {
    maxAgeMs: options.maxAgeMs,
    idleTimeoutMs: options.idleTimeoutMs,
  }

  async function remove(sessionId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.id, sessionId))
  }

  async function read(sessionId: string): Promise<Session | null> {
    const rows = await db
      .select({ data: sessions.data, expiresAt: sessions.expiresAt })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return null

    const nowMs = now()
    // The column is the authority on the absolute ceiling; the record carries the idle one.
    if (row.expiresAt.getTime() <= nowMs || isSessionExpired(row.data, nowMs, lifetime)) {
      await remove(sessionId)
      return null
    }
    return fromSessionRecord(row.data)
  }

  async function write(sessionId: string, session: Session): Promise<void> {
    const nowMs = now()
    const record = toSessionRecord(session, nowMs)
    // Nobody is signed in, so there is nothing to keep and no user to hang the row off.
    if (record === null) return

    const lastSeenAt = new Date(nowMs)
    const expiresAt = new Date(absoluteExpiryOf(record, lifetime))
    await db
      .insert(sessions)
      .values({
        id: sessionId,
        userId: record.userId,
        data: record,
        createdAt: new Date(Date.parse(record.createdAt)),
        lastSeenAt,
        expiresAt,
      })
      // `expires_at` is derived from the record's own sign-in time, so a save never pushes the
      // absolute ceiling further out however often the member comes back.
      .onConflictDoUpdate({
        target: sessions.id,
        set: { data: record, lastSeenAt, expiresAt },
      })
  }

  return {
    get(sessionId, callback) {
      read(sessionId).then(
        (session) => callback(null, session),
        (error: unknown) => callback(error),
      )
    },
    set(sessionId, session, callback) {
      write(sessionId, session).then(
        () => callback(),
        (error: unknown) => callback(error),
      )
    },
    destroy(sessionId, callback) {
      remove(sessionId).then(
        () => callback(),
        (error: unknown) => callback(error),
      )
    },
    async sweepExpired() {
      const gone = await db
        .delete(sessions)
        .where(lte(sessions.expiresAt, new Date(now())))
        .returning({ id: sessions.id })
      return gone.length
    },
  }
}

// --- Redis ------------------------------------------------------------------

/**
 * The slice of an ioredis client the session store uses. Narrow on purpose: a test can supply
 * a stand-in, and no part of the service depends on the rest of the client's surface.
 */
export interface SessionRedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>
  del(key: string): Promise<unknown>
}

/**
 * The store for a deployment with REDIS_URL set, which is what more than one API replica
 * needs. Keys expire on their own; the explicit checks on read exist so that a clock the tests
 * control still decides the outcome.
 */
export function createRedisSessionStore(
  redis: SessionRedisClient,
  options: SessionStoreOptions,
): SessionStore {
  const now = options.now ?? Date.now
  const lifetime: SessionLifetime = {
    maxAgeMs: options.maxAgeMs,
    idleTimeoutMs: options.idleTimeoutMs,
  }
  const keyOf = (sessionId: string): string => `${SESSION_KEY_PREFIX}${sessionId}`

  function decode(value: string): SessionData | null {
    try {
      const parsed: unknown = JSON.parse(value)
      if (parsed === null || typeof parsed !== 'object') return null
      const record = parsed as SessionData
      return Number.isInteger(record.userId) ? record : null
    } catch {
      return null
    }
  }

  async function read(sessionId: string): Promise<Session | null> {
    const value = await redis.get(keyOf(sessionId))
    if (value === null) return null

    const record = decode(value)
    if (record === null || isSessionExpired(record, now(), lifetime)) {
      await redis.del(keyOf(sessionId))
      return null
    }
    return fromSessionRecord(record)
  }

  async function write(sessionId: string, session: Session): Promise<void> {
    const nowMs = now()
    const record = toSessionRecord(session, nowMs)
    if (record === null) return

    // The key lives for whichever lifetime runs out first, so Redis expires it unaided.
    const untilAbsolute = absoluteExpiryOf(record, lifetime) - nowMs
    const ttlMs =
      lifetime.idleTimeoutMs === undefined
        ? untilAbsolute
        : Math.min(lifetime.idleTimeoutMs, untilAbsolute)
    if (ttlMs <= 0) {
      await redis.del(keyOf(sessionId))
      return
    }
    await redis.set(keyOf(sessionId), JSON.stringify(record), 'PX', Math.ceil(ttlMs))
  }

  return {
    get(sessionId, callback) {
      read(sessionId).then(
        (session) => callback(null, session),
        (error: unknown) => callback(error),
      )
    },
    set(sessionId, session, callback) {
      write(sessionId, session).then(
        () => callback(),
        (error: unknown) => callback(error),
      )
    },
    destroy(sessionId, callback) {
      redis.del(keyOf(sessionId)).then(
        () => callback(),
        (error: unknown) => callback(error),
      )
    },
  }
}

// --- choosing one -----------------------------------------------------------

export interface SessionStoreDependencies {
  /** Used when no Redis client is supplied. */
  database: Database
  /** Present exactly when REDIS_URL is configured. */
  redis?: SessionRedisClient | undefined
  now?: () => number
}

/** Redis when one is configured, the `sessions` table otherwise (spec 02 §3). */
export function createConfiguredSessionStore(
  config: DeploymentConfig,
  dependencies: SessionStoreDependencies,
): SessionStore {
  const options: SessionStoreOptions = {
    ...sessionLifetimeOf(config),
    ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
  }
  return dependencies.redis === undefined
    ? createPostgresSessionStore(dependencies.database, options)
    : createRedisSessionStore(dependencies.redis, options)
}

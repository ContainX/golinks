// The session cookie policy and the stores behind it (spec 02 §3).
//
// The cookie carries nothing but a session id, signed with SESSION_SECRET; everything else
// lives server-side in the store. The three stores are the in-process one below (single
// replica and unit tests), the `sessions` table, and Redis; the last two are built in
// `auth/session-stores.ts` and re-exported here so that callers have one place to look.

import { randomBytes } from 'node:crypto'
import fastifyCookie from '@fastify/cookie'
import fastifySession, { type SessionStore } from '@fastify/session'
import type { DeploymentConfig } from '@golinks/shared/config'
import type { FastifyInstance, Session } from 'fastify'

export type {
  PostgresSessionStore,
  SessionLifetime,
  SessionRedisClient,
  SessionStoreDependencies,
  SessionStoreOptions,
} from '../auth/session-stores.ts'
export {
  absoluteExpiryOf,
  createConfiguredSessionStore,
  createPostgresSessionStore,
  createRedisSessionStore,
  fromSessionRecord,
  isSessionExpired,
  SESSION_KEY_PREFIX,
  sessionLifetimeOf,
  toSessionRecord,
} from '../auth/session-stores.ts'
export type { SessionStore }

/** Spec 02 §3 fixes the session id at 32 random bytes, base64url encoded. */
export const SESSION_ID_BYTES = 32

/** A fresh session id. Unguessable is the whole requirement. */
export function createSessionId(): string {
  return randomBytes(SESSION_ID_BYTES).toString('base64url')
}

declare module 'fastify' {
  /**
   * What a session holds (spec 02 §3). The sign-in flow fills these in; everything here is
   * optional because a session exists, empty, before anyone signs in.
   */
  interface Session {
    userId?: string
    providerId?: string
    createdAt?: string
    lastSeenAt?: string
    /** Kept only when OIDC_LOGOUT_AT_IDP is on, for RP-initiated sign-out. */
    idToken?: string
  }
}

interface StoredSession {
  session: Session
  expiresAt: number
}

export interface MemorySessionStore extends SessionStore {
  /** Number of live sessions; used by tests and by the readiness of a single-replica install. */
  size(): number
  clear(): void
}

/**
 * Sessions held in this process only. It is the store the unit tests build on, and the wrong
 * one for anything that outlives a single process: nothing survives a restart and a second
 * replica sees none of it.
 *
 * A deployment gets `createConfiguredSessionStore` instead, which picks Redis when `REDIS_URL`
 * is set and the `sessions` table otherwise. All three implement this same interface and reach
 * the session plugin through `buildApp`'s `sessionStore` option.
 */
export function createMemorySessionStore(now: () => number = Date.now): MemorySessionStore {
  const sessions = new Map<string, StoredSession>()

  const expiryOf = (session: Session): number => {
    const expires = session.cookie?.expires
    if (expires instanceof Date) return expires.getTime()
    const maxAge = session.cookie?.maxAge
    return typeof maxAge === 'number' ? now() + maxAge : Number.POSITIVE_INFINITY
  }

  return {
    set(sessionId, session, callback) {
      sessions.set(sessionId, { session, expiresAt: expiryOf(session) })
      callback()
    },
    get(sessionId, callback) {
      const stored = sessions.get(sessionId)
      if (stored === undefined) {
        callback(null, null)
        return
      }
      if (stored.expiresAt <= now()) {
        sessions.delete(sessionId)
        callback(null, null)
        return
      }
      callback(null, stored.session)
    },
    destroy(sessionId, callback) {
      sessions.delete(sessionId)
      callback()
    },
    size: () => sessions.size,
    clear: () => sessions.clear(),
  }
}

export interface RegisterSessionsOptions {
  /** Defaults to the in-process store. */
  store?: SessionStore
  /** Overrides how session ids are minted. Only a test has a reason to. */
  idGenerator?: () => string
}

export function registerSessions(
  app: FastifyInstance,
  config: DeploymentConfig,
  options: RegisterSessionsOptions = {},
): void {
  // The signing secret is shared with the short-lived sign-in cookie of spec 02 §2.
  app.register(fastifyCookie, { secret: config.session.secret })

  app.register(fastifySession, {
    secret: config.session.secret,
    cookieName: config.session.cookieName,
    store: options.store ?? createMemorySessionStore(),
    // 32 random bytes rather than the plugin's default 24 (spec 02 §3).
    idGenerator: options.idGenerator ?? createSessionId,
    // Nothing is stored until the sign-in flow puts something in the session.
    saveUninitialized: false,
    // The cookie's expiry slides on each request, up to the absolute maximum (spec 02 §3).
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: config.session.cookieSecure,
      // Lax is required so that a top-level navigation to a keyword carries the cookie.
      sameSite: 'lax',
      path: '/',
      // Host-only: no domain attribute, so the short host never sees this cookie.
      maxAge: config.session.maxAgeMs,
    },
  })
}

// Turning a session cookie into `request.member` (spec 02 §3, §5).
//
// The chain is cookie → session record → user row → member. A session whose user has gone or
// been disabled is destroyed on the spot and the request continues as if nobody were signed in,
// which is what spec 01 §2.4 asks for. The revocation is remembered for the request so that the
// hook after this one can clear the cookie and send a browser to the sign-in page.

import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import type { Database } from '../db/client.ts'
import { users } from '../db/schema/index.ts'
import type { CurrentMember, MemberResolver } from '../types.ts'
import { createMemberCache, type MemberCache } from './member-cache.ts'
import type { SessionLifetime } from './session-stores.ts'

/** Why a session stopped being valid part-way through a request (spec 01 §2.4). */
export type SessionRevocationReason = 'account_disabled' | 'account_missing'

const revocations = new WeakMap<FastifyRequest, SessionRevocationReason>()

/** Records that this request arrived with a session that has just been destroyed. */
export function markSessionRevoked(request: FastifyRequest, reason: SessionRevocationReason): void {
  revocations.set(request, reason)
}

/** Why this request's session was destroyed, or undefined when it was not. */
export function sessionRevocationOf(request: FastifyRequest): SessionRevocationReason | undefined {
  return revocations.get(request)
}

/** The session as @fastify/session hands it to a request. */
export type LiveSession = FastifyRequest['session']

/**
 * The live session object, or null on a request the session plugin left alone. The plugin
 * assigns a bare `{}` for a path outside the cookie's scope, which is why this is a check and
 * not a cast.
 */
export function sessionOf(request: FastifyRequest): LiveSession | null {
  const session = request.session as LiveSession | null | undefined
  if (session === null || session === undefined) return null
  return typeof session.get === 'function' ? session : null
}

/** The session id a request presented, used as the rate-limit subject (spec 05 §5). */
export function signedInSessionId(request: FastifyRequest): string | undefined {
  const session = sessionOf(request)
  if (session === null) return undefined
  // An anonymous session gets a fresh id on every request, so it is useless as a limit key.
  return session.get('userId') === undefined ? undefined : session.sessionId
}

export interface MemberResolverOptions {
  /** Defaults to the instance's own handle, so a test app's database is used automatically. */
  database?: Database
  /** Defaults to a cache with the sixty-second lifetime of spec 02 §3. */
  cache?: MemberCache
  /** The lifetimes the cookie slides within. Defaults to the instance's configuration. */
  lifetime?: SessionLifetime
  now?: () => number
}

export interface MemberResolution {
  resolve: MemberResolver
  cache: MemberCache
}

/**
 * Builds the resolver installed with `app.setMemberResolver`.
 *
 * The cookie's expiry slides on every request, capped at the absolute maximum measured from
 * sign-in, so a member who visits daily stays signed in for `SESSION_MAX_AGE` and no longer
 * (spec 02 §3).
 */
export function createMemberResolution(options: MemberResolverOptions = {}): MemberResolution {
  const cache = options.cache ?? createMemberCache({ ...(options.now ? { now: options.now } : {}) })
  const now = options.now ?? Date.now

  /** The member behind a session id, or why there is not one. */
  async function loadMember(
    db: Database,
    userId: string,
  ): Promise<CurrentMember | SessionRevocationReason> {
    const numericId = Number(userId)
    if (!Number.isInteger(numericId) || numericId <= 0) return 'account_missing'

    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        organizationId: users.organizationId,
        role: users.role,
        isEnabled: users.isEnabled,
      })
      .from(users)
      .where(eq(users.id, numericId))
      .limit(1)

    const row = rows[0]
    if (row === undefined) return 'account_missing'
    if (!row.isEnabled) return 'account_disabled'
    return {
      id: String(row.id),
      email: row.email,
      organizationId: row.organizationId,
      role: row.role,
    }
  }

  const resolve: MemberResolver = async (request) => {
    const session = sessionOf(request)
    if (session === null) return null

    const userId = session.get('userId')
    if (userId === undefined) return null

    const cached = cache.get(userId)
    if (cached !== undefined) {
      slideCookie(request, session, options.lifetime, now())
      return cached
    }

    const db = options.database ?? request.server.db
    const member = await loadMember(db, userId)

    if (typeof member === 'string') {
      // Spec 02 §3: the user is gone or disabled, so the session goes with them and the
      // request continues unauthenticated.
      cache.forget(userId)
      await destroySession(request, session)
      markSessionRevoked(request, member)
      return null
    }

    cache.remember(member)
    slideCookie(request, session, options.lifetime, now())
    return member
  }

  return { resolve, cache }
}

async function destroySession(request: FastifyRequest, session: LiveSession): Promise<void> {
  try {
    await session.destroy()
  } catch (error) {
    // The request continues unauthenticated whatever the store said, and the cookie is
    // cleared either way, so a store that is briefly unreachable cannot keep a member in.
    request.log.warn({ err: error }, 'could not destroy the session of a disabled member')
    request.session = null as unknown as LiveSession
  }
}

/**
 * Pushes the cookie's expiry out again, never past sign-in plus the absolute maximum, and
 * never past the idle timeout when one is configured.
 */
function slideCookie(
  request: FastifyRequest,
  session: LiveSession,
  lifetime: SessionLifetime | undefined,
  nowMs: number,
): void {
  const limits = lifetime ?? {
    maxAgeMs: request.server.appConfig.session.maxAgeMs,
    idleTimeoutMs: request.server.appConfig.session.idleTimeoutMs,
  }

  const createdAt = Date.parse(session.get('createdAt') ?? '')
  const untilAbsolute = Number.isNaN(createdAt)
    ? limits.maxAgeMs
    : createdAt + limits.maxAgeMs - nowMs
  const maxAge =
    limits.idleTimeoutMs === undefined
      ? untilAbsolute
      : Math.min(limits.idleTimeoutMs, untilAbsolute)

  if (maxAge > 0) session.options({ maxAge })
}

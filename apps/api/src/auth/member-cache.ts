// The per-process user cache behind `request.member` (spec 02 §3).
//
// Every authenticated request needs the member's row. Spec 02 §3 allows that lookup to be
// cached for up to a minute, which is also the outer bound on how long a disabled account
// keeps working: the entry is what delays the effect, so the ceiling is the guarantee.
//
// The cache is per replica and deliberately tiny in scope — id, email, organization, role — so
// that nothing else in the service is tempted to read a member through it.

import type { FastifyInstance } from 'fastify'
import type { CurrentMember } from '../types.ts'

/** Spec 02 §3: at most sixty seconds. */
export const DEFAULT_MEMBER_CACHE_TTL_MS = 60_000

export interface MemberCacheOptions {
  /** Zero switches the cache off, which is how a test watches a change take effect at once. */
  ttlMs?: number
  now?: () => number
}

export interface MemberCache {
  /** How long an entry is trusted. Zero means every request reads the database. */
  readonly ttlMs: number
  /** The remembered member, or undefined when nothing fresh is held for that id. */
  get(userId: string): CurrentMember | undefined
  /** Holds the member for the cache lifetime. Called after a lookup and after a sign-in. */
  remember(member: CurrentMember): void
  /** Drops one member, so the next request reads the database. */
  forget(userId: string): void
  /** Drops everything. */
  clear(): void
  /** Number of live entries; tests assert against it. */
  size(): number
}

interface CacheEntry {
  member: CurrentMember
  expiresAt: number
}

export function createMemberCache(options: MemberCacheOptions = {}): MemberCache {
  const ttlMs = options.ttlMs ?? DEFAULT_MEMBER_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const entries = new Map<string, CacheEntry>()

  return {
    ttlMs,
    get(userId) {
      if (ttlMs <= 0) return undefined
      const entry = entries.get(userId)
      if (entry === undefined) return undefined
      if (entry.expiresAt <= now()) {
        entries.delete(userId)
        return undefined
      }
      return entry.member
    },
    remember(member) {
      if (ttlMs <= 0) return
      entries.set(member.id, { member, expiresAt: now() + ttlMs })
    },
    forget(userId) {
      entries.delete(userId)
    },
    clear() {
      entries.clear()
    },
    size: () => entries.size,
  }
}

/**
 * The cache an instance is using, kept as an instance decoration so that every encapsulated
 * child inherits it. Sign-in refreshes the entry through here, so a role decided a moment ago
 * is the one the very next request acts on rather than a minute-old copy.
 */
const MEMBER_CACHE = Symbol.for('golinks.auth.memberCache')

type CacheHolder = Record<symbol, MemberCache | undefined>

export function attachMemberCache(app: FastifyInstance, cache: MemberCache): void {
  if (app.hasDecorator(MEMBER_CACHE)) {
    ;(app as unknown as CacheHolder)[MEMBER_CACHE] = cache
    return
  }
  app.decorate(MEMBER_CACHE, cache)
}

export function memberCacheOf(app: FastifyInstance): MemberCache | undefined {
  return (app as unknown as CacheHolder)[MEMBER_CACHE]
}

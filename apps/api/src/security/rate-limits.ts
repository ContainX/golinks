// Rate limits (spec 05 §5, spec 09 §6): the API is limited per session, link creation more
// tightly, and the resolver per IP. Counters live in Redis when one is configured so that the
// limit holds across replicas, and in process memory otherwise.
//
// A Redis that stops answering must not stop the service. Rate limiting is a protection, not a
// correctness requirement, so the counters fall back to this process for the length of the
// outage and one warning is logged when it starts rather than one per request. The limit is
// then enforced per replica instead of per fleet, which is exactly what a deployment without a
// Redis lives with anyway. Sessions are the one Redis use that stays strict (spec 02 §3).

import fastifyRateLimit, { type RateLimitOptions } from '@fastify/rate-limit'
import { type DeploymentConfig, SESSION_COOKIE_NAME } from '@golinks/shared/config'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ApiError } from '../errors.ts'
import { isApiPath, pathnameOf } from './origin-check.ts'

/** Which budget a request draws from, or undefined when it is not limited at all. */
export type RateLimitScope = 'api' | 'resolver'

/**
 * Identifies the caller a limit is counted against. Returning undefined falls back to the
 * client IP, which is what happens for everyone who is not signed in.
 */
export type RateLimitSubjectResolver = (request: FastifyRequest) => string | undefined

/** Paths the web app shell loads on every visit; they are not part of the keyword space. */
const UNLIMITED_PATHS = new Set(['/', '/favicon.ico', '/robots.txt'])

export function rateLimitScope(pathname: string): RateLimitScope | undefined {
  if (isApiPath(pathname)) return 'api'
  // Health, auth, metrics, the OpenSearch descriptor and the app shell are not limited here.
  if (pathname.startsWith('/_/')) return undefined
  if (UNLIMITED_PATHS.has(pathname)) return undefined
  if (pathname.startsWith('/assets/')) return undefined
  return 'resolver'
}

/**
 * Until sign-in lands every caller is counted by IP. Once a session cookie is presented the
 * session becomes the subject, which is what spec 05 §5 asks for; a later task swaps this for
 * the loaded session by calling `setRateLimitSubjectResolver`.
 */
export const defaultRateLimitSubjectResolver: RateLimitSubjectResolver = (request) => {
  const cookie = request.cookies?.[SESSION_COOKIE_NAME]
  return cookie === undefined ? undefined : `session:${cookie}`
}

function rateLimitKey(request: FastifyRequest, scope: RateLimitScope): string {
  // The resolver is limited per IP even for signed-in members (spec 05 §5).
  if (scope === 'resolver') return `resolver:ip:${request.ip}`
  const subject = request.server.resolveRateLimitSubject(request)
  return subject === undefined ? `api:ip:${request.ip}` : `api:${subject}`
}

function rateLimited(after: string): ApiError {
  return new ApiError('rate_limited', `Too many requests. Retry in ${after}.`, {
    details: { retryAfter: after },
  })
}

// --- counter stores ---------------------------------------------------------

/** One window's worth of counting, as @fastify/rate-limit reads it back. */
export interface RateLimitCount {
  current: number
  /** Milliseconds left in the window. */
  ttl: number
}

type CountCallback = (error: Error | null, count?: RateLimitCount) => void

/** The store interface @fastify/rate-limit drives, both for the plugin and for its children. */
export interface RateLimitCounterStore {
  incr(key: string, callback: CountCallback, timeWindowMs: number, max: number): void
  /** Reports the window without touching it; used only by `{ increment: false }` callers. */
  read(key: string, callback: CountCallback, timeWindowMs: number, max: number): void
  /** The plugin hands this the merged route options; only `routeInfo` is read. */
  child(routeOptions: unknown): RateLimitCounterStore
}

/** The one field of the merged route options a child store reads. */
export interface RateLimitChildOptions {
  routeInfo?: { method?: string | string[] | undefined; url?: string | undefined } | undefined
}

/** The slice of an ioredis client the shared counters need. */
export interface RateLimitRedisClient {
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>
}

/** Where a store reports an outage and its end. */
export interface RateLimitStoreLogger {
  info(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
}

/** Prefix every counter key carries, so a shared Redis stays legible. */
export const RATE_LIMIT_KEY_PREFIX = 'rate-limit:'

/**
 * One fixed window, counted in Redis. `INCR` creates the key and `PEXPIRE` gives it the window;
 * every later hit reads what is left of it. A key that somehow lost its expiry is given one
 * back rather than counting forever.
 */
const INCREMENT_SCRIPT = `
  local current = redis.call('INCR', KEYS[1])
  local ttl
  if current == 1 then
    redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
    ttl = tonumber(ARGV[1])
  else
    ttl = redis.call('PTTL', KEYS[1])
    if ttl < 0 then
      redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
      ttl = tonumber(ARGV[1])
    end
  end
  return {current, ttl}
`

/** The same window, read without spending anything from it. */
const READ_SCRIPT = `
  local current = redis.call('GET', KEYS[1])
  if not current then return {0, 0} end
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = 0 end
  return {tonumber(current), ttl}
`

/** Turns whatever Redis returned into a count, or throws so the caller can fall back. */
export function decodeRateLimitCount(value: unknown): RateLimitCount {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error('The rate limit counter returned something other than a pair.')
  }
  const current = Number(value[0])
  const ttl = Number(value[1])
  if (!Number.isFinite(current) || !Number.isFinite(ttl)) {
    throw new Error('The rate limit counter returned a non-numeric pair.')
  }
  return { current, ttl }
}

/** How many distinct keys one process counts before it starts forgetting expired ones. */
const LOCAL_COUNTER_CAPACITY = 20_000

interface LocalWindow {
  current: number
  startedAt: number
}

/**
 * Counting in this process: a fixed window per key, the same shape the shared counter reports.
 * It is the whole story for a deployment without a Redis and the safety net for one whose Redis
 * has stopped answering.
 */
export function createLocalRateLimitCounters(now: () => number = Date.now): {
  incr(key: string, timeWindowMs: number): RateLimitCount
  read(key: string, timeWindowMs: number): RateLimitCount
  size(): number
} {
  const windows = new Map<string, LocalWindow>()

  function prune(nowMs: number, timeWindowMs: number): void {
    for (const [key, window] of windows) {
      if (window.startedAt + timeWindowMs <= nowMs) windows.delete(key)
    }
  }

  return {
    incr(key, timeWindowMs) {
      const nowMs = now()
      if (windows.size >= LOCAL_COUNTER_CAPACITY) prune(nowMs, timeWindowMs)

      const window = windows.get(key)
      if (window === undefined || window.startedAt + timeWindowMs <= nowMs) {
        windows.set(key, { current: 1, startedAt: nowMs })
        return { current: 1, ttl: timeWindowMs }
      }
      window.current += 1
      return { current: window.current, ttl: window.startedAt + timeWindowMs - nowMs }
    },

    read(key, timeWindowMs) {
      const nowMs = now()
      const window = windows.get(key)
      if (window === undefined || window.startedAt + timeWindowMs <= nowMs) {
        return { current: 0, ttl: 0 }
      }
      return { current: window.current, ttl: window.startedAt + timeWindowMs - nowMs }
    },

    size: () => windows.size,
  }
}

/** Shared across every store and child, so one outage produces one warning. */
interface OutageState {
  isDown: boolean
}

export interface FailOpenStoreOptions {
  redis: RateLimitRedisClient
  logger: RateLimitStoreLogger
  keyPrefix?: string
  now?: () => number
}

/** The constructor shape @fastify/rate-limit's `store` option expects. */
export type RateLimitStoreConstructor = new (options: unknown) => RateLimitCounterStore

/**
 * Builds the store class the plugin instantiates. Counting happens in Redis; a Redis that
 * rejects hands the request straight to this process's counters, and the transition each way is
 * logged exactly once.
 */
export function createFailOpenRateLimitStore(
  options: FailOpenStoreOptions,
): RateLimitStoreConstructor {
  const { redis, logger } = options
  const outage: OutageState = { isDown: false }
  const rootPrefix = options.keyPrefix ?? RATE_LIMIT_KEY_PREFIX

  function reportDown(error: unknown): void {
    if (outage.isDown) return
    outage.isDown = true
    logger.warn(
      { err: error },
      'rate limit counters are unreachable; counting in this process until Redis answers again',
    )
  }

  function reportUp(): void {
    if (!outage.isDown) return
    outage.isDown = false
    logger.info({}, 'rate limit counters are back in Redis')
  }

  class FailOpenRateLimitStore implements RateLimitCounterStore {
    private readonly prefix: string
    private readonly local = createLocalRateLimitCounters(options.now)

    constructor(_pluginOptions: unknown, prefix: string = rootPrefix) {
      this.prefix = prefix
    }

    private count(
      script: string,
      key: string,
      callback: CountCallback,
      timeWindowMs: number,
      fallback: () => RateLimitCount,
    ): void {
      redis.eval(script, 1, `${this.prefix}${key}`, timeWindowMs).then(
        (value) => {
          try {
            const count = decodeRateLimitCount(value)
            reportUp()
            callback(null, count)
          } catch (error) {
            reportDown(error)
            callback(null, fallback())
          }
        },
        (error: unknown) => {
          reportDown(error)
          callback(null, fallback())
        },
      )
    }

    incr(key: string, callback: CountCallback, timeWindowMs: number): void {
      this.count(INCREMENT_SCRIPT, key, callback, timeWindowMs, () =>
        this.local.incr(`${this.prefix}${key}`, timeWindowMs),
      )
    }

    read(key: string, callback: CountCallback, timeWindowMs: number): void {
      this.count(READ_SCRIPT, key, callback, timeWindowMs, () =>
        this.local.read(`${this.prefix}${key}`, timeWindowMs),
      )
    }

    child(routeOptions: unknown): RateLimitCounterStore {
      // Route-scoped keys, so two routes that happen to generate the same subject key do not
      // share a budget. Mirrors what the plugin's own stores do.
      const info = (routeOptions as RateLimitChildOptions | undefined)?.routeInfo
      const method = Array.isArray(info?.method) ? info.method.join('-') : (info?.method ?? '')
      return new FailOpenRateLimitStore(routeOptions, `${this.prefix}${method}${info?.url ?? ''}:`)
    }
  }

  return FailOpenRateLimitStore
}

// --- registration -----------------------------------------------------------

export interface RegisterRateLimitsOptions {
  /** An ioredis client (or compatible) for shared counters. */
  redis?: unknown
}

/**
 * The named limits. The API limit is applied globally to `/_/api`; the others are attached by
 * the routes that own them: `linkCreate` by `POST /_/api/v1/links`, `resolver` by the
 * catch-all keyword route.
 */
export interface NamedRateLimits {
  api: RateLimitOptions
  linkCreate: RateLimitOptions
  resolver: RateLimitOptions
}

export function registerRateLimits(
  app: FastifyInstance,
  config: DeploymentConfig,
  options: RegisterRateLimitsOptions = {},
): NamedRateLimits {
  const { windowMs, apiPerWindow, linkCreatePerWindow, resolverPerWindow } = config.rateLimit

  const named: NamedRateLimits = {
    api: {
      max: apiPerWindow,
      timeWindow: windowMs,
      keyGenerator: (request) => rateLimitKey(request, 'api'),
    },
    linkCreate: {
      max: linkCreatePerWindow,
      timeWindow: windowMs,
      keyGenerator: (request) => {
        const subject = request.server.resolveRateLimitSubject(request)
        return `link-create:${subject ?? `ip:${request.ip}`}`
      },
    },
    resolver: {
      max: resolverPerWindow,
      timeWindow: windowMs,
      keyGenerator: (request) => rateLimitKey(request, 'resolver'),
    },
  }

  if (!config.rateLimit.enabled) return named

  // With no Redis the plugin's own in-process store is already the right answer; with one, the
  // counters go through the store that falls back to this process when Redis stops answering.
  const store =
    options.redis === undefined
      ? undefined
      : createFailOpenRateLimitStore({
          redis: options.redis as RateLimitRedisClient,
          logger: app.log,
        })

  app.register(fastifyRateLimit, {
    global: true,
    max: (request) => {
      const scope = rateLimitScope(pathnameOf(request.url))
      return scope === 'resolver' ? resolverPerWindow : apiPerWindow
    },
    timeWindow: windowMs,
    keyGenerator: (request) => {
      const scope = rateLimitScope(pathnameOf(request.url))
      return rateLimitKey(request, scope ?? 'api')
    },
    allowList: (request) => rateLimitScope(pathnameOf(request.url)) === undefined,
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    errorResponseBuilder: (_request, context) => rateLimited(context.after),
    ...(store === undefined ? {} : { store }),
  })

  return named
}

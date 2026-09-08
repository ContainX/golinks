// Rate limits (spec 05 §5, spec 09 §6): the API is limited per session, link creation more
// tightly, and the resolver per IP. Counters live in Redis when one is configured so that the
// limit holds across replicas, and in process memory otherwise.

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
    ...(options.redis === undefined ? {} : { redis: options.redis }),
  })

  return named
}

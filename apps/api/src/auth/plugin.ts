// Wiring the identity foundation into an instance.
//
// One registration installs everything a signed-in request needs: `request.member`, the
// per-session rate-limit subject of spec 05 §5, the disabled-account enforcement of spec 01
// §2.4, the OIDC sign-in and sign-out of spec 02 §§2 and 4, the test sign-in of spec 02 §8,
// and the profile endpoints of spec 05 §2.2.
//
// It is passed to `buildApp` through `plugins`, so it runs after the security baseline and
// before the built-in routes.

import { registerMeRoutes } from '../routes/me.ts'
import { isApiPath, pathnameOf } from '../security/origin-check.ts'
import type { GoLinksApp } from '../types.ts'
import { attachMemberCache, createMemberCache, type MemberCache } from './member-cache.ts'
import {
  createMemberResolution,
  sessionRevocationOf,
  signedInSessionId,
} from './member-resolver.ts'
import { createProviderRegistry, type ProviderRegistry } from './oidc/registry.ts'
import { registerOidcRoutes } from './oidc/routes.ts'
import { signInPathWithError } from './redirect-to.ts'
import { registerSignInOptionsRoute } from './sign-in-options.ts'
import { registerSignOutRoutes } from './sign-out.ts'
import { registerTestLoginRoutes } from './test-login.ts'

export interface IdentityOptions {
  /**
   * How long a user lookup is trusted, in milliseconds. Defaults to the sixty seconds of
   * spec 02 §3; zero switches the cache off, which is how a test watches a change land at once.
   */
  memberCacheTtlMs?: number
  /** Clock, injectable so lifetime and cache-window tests do not have to wait. */
  now?: () => number
  /** Overrides the cache outright, for a test that wants to inspect or clear it. */
  memberCache?: MemberCache
  /**
   * Overrides the identity providers the sign-in routes offer. Built from the deployment's
   * own configuration otherwise; a test uses this to stand in for discovery.
   */
  providerRegistry?: ProviderRegistry
}

/**
 * Paths a just-revoked session is never redirected away from: the API answers 401, the sign-in
 * routes would loop, and health checks belong to the operator rather than to a member.
 */
const NEVER_REDIRECTED = ['/_/api', '/_/auth', '/_/health', '/_/metrics']
const NEVER_REDIRECTED_FILES = new Set(['/favicon.ico', '/robots.txt'])

/** Whether a browser landing here should be sent to the sign-in page (spec 01 §2.4). */
export function redirectsRevokedSession(method: string, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false
  if (NEVER_REDIRECTED_FILES.has(pathname)) return false
  if (pathname.startsWith('/assets/')) return false
  return !NEVER_REDIRECTED.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/** Installs the member resolver, the revocation hook, and the identity routes. */
export function createIdentityPlugin(
  options: IdentityOptions = {},
): (app: GoLinksApp) => Promise<void> {
  return async (app) => {
    const config = app.appConfig

    const cache =
      options.memberCache ??
      createMemberCache({
        ...(options.memberCacheTtlMs === undefined ? {} : { ttlMs: options.memberCacheTtlMs }),
        ...(options.now === undefined ? {} : { now: options.now }),
      })
    attachMemberCache(app, cache)

    const resolution = createMemberResolution({
      cache,
      ...(options.now === undefined ? {} : { now: options.now }),
      lifetime: {
        maxAgeMs: config.session.maxAgeMs,
        idleTimeoutMs: config.session.idleTimeoutMs,
      },
    })
    app.setMemberResolver(resolution.resolve)

    // Spec 05 §5 counts the API per session; everyone else is still counted per IP.
    app.setRateLimitSubjectResolver((request) => {
      const sessionId = signedInSessionId(request)
      return sessionId === undefined ? undefined : `session:${sessionId}`
    })

    // Runs after the hook that fills in `request.member`, so a session the resolver has just
    // destroyed is dealt with before any route sees the request (spec 01 §2.4).
    app.addHook('onRequest', async (request, reply) => {
      const reason = sessionRevocationOf(request)
      if (reason === undefined) return

      reply.clearCookie(config.session.cookieName, { path: '/' })

      const pathname = pathnameOf(request.url)
      if (isApiPath(pathname) || !redirectsRevokedSession(request.method, pathname)) return

      request.log.info({ reason, pathname }, 'session revoked; sending the browser to sign in')
      return reply
        .header('cache-control', 'no-store')
        .redirect(signInPathWithError('account_disabled'), 302)
    })

    // Spec 02 §§2 and 4. The routes exist even where no provider is configured, which is the
    // shape a test-mode deployment has: every provider id is then simply unknown.
    const providers =
      options.providerRegistry ?? createProviderRegistry(config, { logger: app.log })
    registerOidcRoutes(app, providers, {
      ...(options.now === undefined ? {} : { now: options.now }),
    })
    registerSignOutRoutes(app, providers)
    registerSignInOptionsRoute(app, providers)

    if (config.authTest.enabled) {
      registerTestLoginRoutes(app, { ...(options.now === undefined ? {} : { now: options.now }) })
    }
    registerMeRoutes(app)
  }
}

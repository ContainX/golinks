// Security headers applied to every response (spec 02 §7).

import fastifyHelmet from '@fastify/helmet'
import type { DeploymentConfig } from '@golinks/shared/config'
import type { FastifyInstance, FastifyReply } from 'fastify'

/**
 * The policy of spec 02 §7, in the order the header lists it. Inline styles are allowed
 * because the component library injects them at runtime; scripts stay strict. `img-src`
 * allows https so that organization branding images load (spec 06 §2).
 */
export const CONTENT_SECURITY_POLICY: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['default-src', ["'self'"]],
  ['script-src', ["'self'"]],
  ['style-src', ["'self'", "'unsafe-inline'"]],
  ['img-src', ["'self'", 'data:', 'https:']],
  ['font-src', ["'self'", 'data:']],
  ['connect-src', ["'self'"]],
  ['frame-ancestors', ["'none'"]],
  ['base-uri', ["'self'"]],
  ['form-action', ["'self'"]],
]

/** The same policy in the shape helmet takes. */
export const CONTENT_SECURITY_POLICY_DIRECTIVES: Record<string, string[]> = Object.fromEntries(
  CONTENT_SECURITY_POLICY.map(([directive, values]) => [directive, [...values]]),
)

/** The header value helmet emits for the policy above; directives are separated by `;`. */
export const CONTENT_SECURITY_POLICY_HEADER = CONTENT_SECURITY_POLICY.map(
  ([directive, values]) => `${directive} ${values.join(' ')}`,
).join(';')

export const HSTS_HEADER = 'max-age=31536000; includeSubDomains'
export const REFERRER_POLICY = 'strict-origin-when-cross-origin'

/** Redirects out of the resolver must not leak the keyword to the destination (spec 04 §7). */
export const REDIRECT_REFERRER_POLICY = 'no-referrer'
export const REDIRECT_CACHE_CONTROL = 'no-store'

/**
 * Applies the redirect-specific overrides. The resolver calls this immediately before sending
 * a 302 so that the keyword never reaches the destination and no cache keeps the answer.
 */
export function applyRedirectHeaders(reply: FastifyReply): FastifyReply {
  reply.header('referrer-policy', REDIRECT_REFERRER_POLICY)
  reply.header('cache-control', REDIRECT_CACHE_CONTROL)
  return reply
}

export function registerSecurityHeaders(app: FastifyInstance, config: DeploymentConfig): void {
  app.register(fastifyHelmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: CONTENT_SECURITY_POLICY_DIRECTIVES,
    },
    // Only meaningful, and only safe, when the canonical origin is already https.
    strictTransportSecurity: config.isCanonicalSecure
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
    xContentTypeOptions: true,
    referrerPolicy: { policy: REFERRER_POLICY },
    // The service is never framed; `frame-ancestors 'none'` says so to modern browsers and
    // this says it to the rest.
    xFrameOptions: { action: 'deny' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    crossOriginEmbedderPolicy: false,
  })
}

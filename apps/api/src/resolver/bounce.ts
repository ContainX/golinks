// The short-host bounce (spec 04 §2, spec 11 §2).
//
// `http://go/handbook` and `https://links.example.com/handbook` are the same request wearing
// two names. Only the canonical host does any work: everything that arrives under another name
// is sent there with its path and query intact, before the session is looked at. That is what
// lets the short host stay plain HTTP with no cookies and no certificate.
//
// The bounce covers `/` and `/_/**` too, so a member who types `go/` lands on the directory.
// Health probes are the exception: they are asked by schedulers and load balancers that reach
// the service by address, and a redirect would read as a failure.

import type { DeploymentConfig } from '@golinks/shared/config'
import type { FastifyInstance } from 'fastify'
import { pathnameOf } from '../security/origin-check.ts'

/** The one prefix that answers on whatever host it is asked on (spec 05 §3). */
export const BOUNCE_EXEMPT_PREFIX = '/_/health'

/** Status of the bounce. Not permanent: which host is canonical is a deployment decision. */
export const BOUNCE_STATUS = 302

export function isBounceExempt(pathname: string): boolean {
  return pathname === BOUNCE_EXEMPT_PREFIX || pathname.startsWith(`${BOUNCE_EXEMPT_PREFIX}/`)
}

/**
 * Whether the name a request arrived under is the canonical one. Host names are
 * case-insensitive, and the comparison includes the port, because `BASE_URL` fixes both.
 */
export function isCanonicalHost(host: string, canonicalHost: string): boolean {
  return host.toLowerCase() === canonicalHost.toLowerCase()
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: a header value may not carry them
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g

/** `<BASE_URL><original path and query>`, which is the whole of the bounce (spec 04 §2). */
export function bounceLocation(baseUrl: string, requestUrl: string): string {
  const target = requestUrl.replace(CONTROL_CHARACTERS, '')
  return `${baseUrl}${target.startsWith('/') ? target : `/${target}`}`
}

/**
 * Installs the bounce.
 *
 * It is an `onRequest` hook rather than part of the resolver's handler because it applies to
 * every route, and it is installed before the session plugin so that a request under another
 * name is answered without a cookie ever being read.
 */
export function registerShortHostBounce(app: FastifyInstance, config: DeploymentConfig): void {
  const { canonicalHost, baseUrl } = config

  app.addHook('onRequest', async (request, reply) => {
    if (isCanonicalHost(request.host, canonicalHost)) return
    if (isBounceExempt(pathnameOf(request.url))) return

    reply.header('cache-control', 'no-store')
    reply.redirect(bounceLocation(baseUrl, request.url), BOUNCE_STATUS)
    // The bounce runs before the resolver route, so it reports its own outcome.
    if (app.hasDecorator('metrics')) app.metrics.recordResolverOutcome('bounce', 0)
    return reply
  })
}

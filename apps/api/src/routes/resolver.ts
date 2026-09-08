// The resolver (spec 04). Every path that is not `/_/**` and not one of the fixed static
// files is a keyword, and this is what turns it into a redirect.
//
// The hot path is deliberately short: the organization's settings, which are cached, then at
// most two link queries, then the header. Everything that is not needed to answer the member —
// the visit counters, the visit row — happens after the response has gone out.

import { methodNotAllowed, notFound } from '../errors.ts'
import { resolverLogFields } from '../logging.ts'
import { createResolverLookup } from '../resolver/lookup.ts'
import { locationHeaderOf, resolverOutcomeOf } from '../resolver/outcomes.ts'
import { parseResolverRequest, splitRequestPath } from '../resolver/parse.ts'
import {
  buildHitLocation,
  sendDestinationRedirect,
  sendLoginRedirect,
  sendMissRedirect,
  sendUnserializableDestination,
} from '../resolver/redirect.ts'
import { resolveRequest } from '../resolver/resolve.ts'
import {
  createDatabaseVisitWriter,
  createVisitRecorder,
  visitSourceOf,
} from '../resolver/visits.ts'
import { pathnameOf } from '../security/origin-check.ts'
import type { GoLinksApp } from '../types.ts'

/** The resolver answers GET and HEAD only; everything else is 405 (spec 04 §1). */
export const RESOLVER_METHODS = ['GET', 'HEAD'] as const

const REFUSED_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

/** How long shutdown waits for visits it has already accepted (spec 04 §6). */
export const VISIT_DRAIN_TIMEOUT_MS = 2_000

/** A timer that never keeps the process alive on its own. */
function after(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref()
  })
}

/**
 * A user id as `link_visits.user_id` stores it, or undefined when the member carries something
 * that is not one. The column is a bigint; `CurrentMember.id` is the same value as text.
 */
function visitUserId(id: string): number | undefined {
  const parsed = Number(id)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

/**
 * Declares the resolver's routes and the two seams it reads through: `app.resolverLookup` for
 * the queries and `app.visitRecorder` for the writes. A plugin passed to `buildApp` can
 * decorate either one first, and this leaves it in place.
 */
export function registerResolverRoutes(app: GoLinksApp): void {
  if (!app.hasDecorator('resolverLookup')) {
    app.decorate(
      'resolverLookup',
      createResolverLookup(() => app.db),
    )
  }

  app.decorateRequest('resolvedVisit', null)
  if (!app.hasDecorator('visitRecorder')) {
    app.decorate(
      'visitRecorder',
      createVisitRecorder({
        write: createDatabaseVisitWriter(() => app.db),
        logger: app.log,
      }),
    )
  }

  // A visit that has been accepted is worth waiting for at shutdown, but never for long: a
  // store that has stopped answering must not hold the process open.
  app.addHook('onClose', async () => {
    await Promise.race([app.visitRecorder.settled(), after(VISIT_DRAIN_TIMEOUT_MS)])
  })

  app.route({
    method: [...RESOLVER_METHODS],
    url: '/*',
    config: { rateLimit: app.rateLimits.resolver },
    // Spec 04 §6: the writes happen once the member already has their redirect.
    onResponse: async (request, reply) => {
      // The bounce answered before this route ran and reported its own outcome.
      if (request.bounced) return
      const outcome = resolverOutcomeOf(
        reply.statusCode,
        locationHeaderOf(reply.getHeader('location')),
      )
      if (outcome !== null) app.metrics.recordResolverOutcome(outcome, reply.elapsedTime / 1000)

      const visit = request.resolvedVisit
      if (visit === null) return
      request.resolvedVisit = null
      app.visitRecorder.record(visit)
    },
    handler: async (request, reply) => {
      const pathname = pathnameOf(request.url)
      // Application paths that reached the catch-all are missing resources, not keywords.
      if (pathname.startsWith('/_/')) throw notFound()

      const segments = splitRequestPath(pathname)
      // `/` is the web app's directory (spec 04 §1); with no web app built there is nothing.
      if (segments.length === 0) throw notFound()

      const member = request.member
      if (member === null) return sendLoginRedirect(reply, request.url)

      const settings = await app.organizationSettings.getSettings(member.organizationId)
      const parsed = parseResolverRequest(segments, settings)
      const resolution = await resolveRequest(parsed, app.resolverLookup, {
        organizationId: member.organizationId,
        rules: settings.keywords,
        logger: request.log,
      })

      if (resolution.outcome === 'miss') {
        request.log.info(
          resolverLogFields({
            namespace: parsed.namespace,
            keyword: parsed.canonicalKeyword,
            outcome: 'miss',
          }),
          'keyword did not resolve',
        )
        return sendMissRedirect(reply, parsed)
      }

      const { link } = resolution
      const built = buildHitLocation(resolution)
      if (!built.ok) {
        // The destination is what is broken, so it is tempting to log it whole; the host is
        // still the most a log line may carry (spec 09 §5). The failure's own message quotes
        // the destination in full, so the line takes its code instead. The owner has the rest.
        request.log.error(
          {
            linkId: link.id,
            ...resolverLogFields({
              namespace: link.namespace,
              keyword: link.keyword,
              outcome: 'unserializable',
              destination: link.destination,
            }),
            reason: built.code,
          },
          'a stored destination could not be serialized as a URL',
        )
        return sendUnserializableDestination(
          reply,
          link,
          await app.resolverLookup.findOwnerEmail(link.ownerId),
        )
      }

      const userId = visitUserId(member.id)
      if (userId !== undefined) {
        request.resolvedVisit = {
          linkId: link.id,
          organizationId: member.organizationId,
          userId,
          via: visitSourceOf((request.query as Record<string, unknown> | undefined)?.via),
        }
      }

      request.log.info(
        resolverLogFields({
          namespace: link.namespace,
          keyword: link.keyword,
          outcome: 'hit',
          destination: built.location,
        }),
        'keyword resolved',
      )
      return sendDestinationRedirect(reply, built.location)
    },
  })

  app.route({
    method: [...REFUSED_METHODS],
    url: '/*',
    config: { rateLimit: app.rateLimits.resolver },
    handler: async (request, reply) => {
      // Unknown application paths are missing resources, not the wrong method.
      if (pathnameOf(request.url).startsWith('/_/')) throw notFound()
      reply.header('allow', RESOLVER_METHODS.join(', '))
      throw methodNotAllowed(RESOLVER_METHODS)
    },
  })
}

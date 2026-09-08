// The four answers the resolver can give (spec 04 §3, §7, §8).
//
// Every one of them is a response the member sees directly, so each carries `Cache-Control:
// no-store`: what a keyword means is per-organization and changes the moment an owner edits
// the link. Only the destination redirect also drops the referrer, so the keyword never
// reaches the site it points at (spec 02 §7).

import { buildRedirectLocation, type RedirectBuild } from '@golinks/shared/destinations'
import type { FastifyReply } from 'fastify'
import { applyRedirectHeaders } from '../security/headers.ts'
import type { ParsedResolverRequest } from './parse.ts'
import { sanitizeRedirectTarget } from './redirect-target.ts'
import type { ResolvableLink, ResolverHit } from './resolve.ts'

/** Destinations change, so a redirect out of the resolver is never permanent (spec 04 §7). */
export const RESOLVER_REDIRECT_STATUS = 302

/** Where a member without a session is sent (spec 02 §2). */
export const LOGIN_PATH = '/_/auth/login'

/** The web app's directory, which a miss pre-fills (spec 04 §8). */
export const DIRECTORY_PATH = '/_/'

/** Answered when a stored destination can no longer be serialized (spec 04 §7). */
export const UNSERIALIZABLE_DESTINATION_STATUS = 502

/**
 * Appends the segments a prefix-fallback hit did not consume (spec 04 §5.3).
 *
 * Each segment is encoded as a URL component, the same treatment placeholder values get in
 * §7, so that a space or a `/` a member typed survives as part of one path segment instead of
 * changing the shape of the destination.
 */
export function appendRemainder(destination: string, remainder: readonly string[]): string {
  if (remainder.length === 0) return destination
  const suffix = remainder.map((segment) => encodeURIComponent(segment)).join('/')
  return `${destination.replace(/\/+$/, '')}/${suffix}`
}

/**
 * The `Location` value for a hit: substitute the captured values, then serialize through the
 * URL parser so the header is ASCII and an internationalized host becomes its ASCII form.
 */
export function buildHitLocation(hit: ResolverHit): RedirectBuild {
  return buildRedirectLocation(appendRemainder(hit.link.destination, hit.remainder), hit.values)
}

/** `/_/auth/login?redirectTo=<path and query>`, with the target sanitized (spec 02 §2.2). */
export function loginLocation(requestUrl: string): string {
  const parameters = new URLSearchParams({ redirectTo: sanitizeRedirectTarget(requestUrl) })
  return `${LOGIN_PATH}?${parameters.toString()}`
}

/**
 * `/_/?keyword=<display form>&namespace=<ns>` (spec 04 §8). The namespace is left out when it
 * is the organization's default, and the keyword keeps the punctuation the member typed so
 * that the creation form shows what they meant.
 */
export function missLocation(request: ParsedResolverRequest): string {
  const parameters = new URLSearchParams({ keyword: request.displayKeywordPath })
  if (!request.isDefaultNamespace) parameters.set('namespace', request.namespace)
  return `${DIRECTORY_PATH}?${parameters.toString()}`
}

function sendResolverRedirect(reply: FastifyReply, location: string): FastifyReply {
  reply.header('cache-control', 'no-store')
  return reply.redirect(location, RESOLVER_REDIRECT_STATUS)
}

/** The bounce a member without a session takes on their way to the keyword (spec 04 §3). */
export function sendLoginRedirect(reply: FastifyReply, requestUrl: string): FastifyReply {
  return sendResolverRedirect(reply, loginLocation(requestUrl))
}

/** The directory, pre-filled with what the member asked for (spec 04 §8). */
export function sendMissRedirect(
  reply: FastifyReply,
  request: ParsedResolverRequest,
): FastifyReply {
  return sendResolverRedirect(reply, missLocation(request))
}

/** The redirect itself: 302, `Location`, no store, no referrer (spec 04 §7). */
export function sendDestinationRedirect(reply: FastifyReply, location: string): FastifyReply {
  applyRedirectHeaders(reply)
  return reply.redirect(location, RESOLVER_REDIRECT_STATUS)
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character)
}

/** `go/handbook`: the namespace and display keyword a member would type. */
export function linkPathOf(link: Pick<ResolvableLink, 'namespace' | 'displayKeyword'>): string {
  return `${link.namespace}/${link.displayKeyword}`
}

/**
 * The page shown instead of a redirect to garbage (spec 04 §7). It names the link and its
 * owner, because the member who hit it can do nothing but tell the owner.
 */
export function unserializableDestinationPage(linkPath: string, ownerEmail: string | null): string {
  const owner =
    ownerEmail === null
      ? 'Ask an administrator to repair it.'
      : `Its owner is <a href="mailto:${escapeHtml(ownerEmail)}">${escapeHtml(ownerEmail)}</a>.`
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>This link cannot be followed</title></head>',
    '<body>',
    '<h1>This link cannot be followed</h1>',
    `<p><code>${escapeHtml(linkPath)}</code> has a destination that is no longer a usable address, so you have not been sent anywhere.</p>`,
    `<p>${owner}</p>`,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/** Answers a hit whose destination will not serialize, rather than redirecting to garbage. */
export function sendUnserializableDestination(
  reply: FastifyReply,
  link: Pick<ResolvableLink, 'namespace' | 'displayKeyword'>,
  ownerEmail: string | null,
): FastifyReply {
  reply.header('cache-control', 'no-store')
  reply.type('text/html; charset=utf-8')
  return reply
    .code(UNSERIALIZABLE_DESTINATION_STATUS)
    .send(unserializableDestinationPage(linkPathOf(link), ownerEmail))
}

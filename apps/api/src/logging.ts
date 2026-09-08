// Structured logging and the request id that ties log lines, responses, and error reports
// together (spec 09 §5).
//
// Spec 09 §5 fixes what a completed request has to say for itself: the request id, the member
// and organization when somebody is signed in, the matched route, the method, the status, and
// how long it took. The matched route is deliberate — for the resolver the URL is a keyword,
// and `/*` is what every one of them has in common. Resolver lines add the namespace, the
// canonical keyword, the outcome, and the destination's host; the destination itself never
// reaches the log stream.

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { DeploymentConfig } from '@golinks/shared/config'
import type { FastifyServerOptions } from 'fastify'
import { UNMATCHED_ROUTE } from './metrics/plugin.ts'

export const REQUEST_ID_HEADER = 'x-request-id'

/** Printable ASCII only, so that the value can be echoed back into a response header safely. */
const REQUEST_ID_PATTERN = /^[\x20-\x7e]{1,200}$/

/** Headers that carry credentials and are removed wherever they appear (spec 09 §5). */
export const REDACTED_HEADER_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["set-cookie"]',
  'res.headers.authorization',
  'res.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'err.config.headers',
] as const

/** Returns the caller supplied request id when it is well formed. */
export function readRequestIdHeader(value: string | string[] | undefined): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  if (candidate === undefined) return undefined
  const trimmed = candidate.trim()
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : undefined
}

/**
 * `X-Request-Id` is honored only when a reverse proxy is trusted (spec 09 §5 and §7); otherwise
 * any client could choose its own id and pollute the logs of another request.
 */
export function createRequestIdGenerator(
  trustProxy: boolean,
): (request: IncomingMessage) => string {
  if (!trustProxy) return () => randomUUID()
  return (request) => readRequestIdHeader(request.headers[REQUEST_ID_HEADER]) ?? randomUUID()
}

// --- the fields a request line carries --------------------------------------

/**
 * The parts of a request the log builders read. Structural rather than `FastifyRequest`, so the
 * builders can be exercised without standing up a server.
 */
export interface LoggableRequest {
  id?: unknown
  method?: string | undefined
  url?: string | undefined
  host?: string | undefined
  ip?: string | undefined
  routeOptions?: { url?: string | undefined } | undefined
  member?: { id: string; organizationId: string } | null | undefined
}

/** The parts of a reply the completion builder reads. */
export interface LoggableReply {
  statusCode?: number | undefined
  elapsedTime?: number | undefined
  request?: LoggableRequest | undefined
}

/**
 * Everything spec 09 §5 asks a completed request to record. A type alias rather than an
 * interface, because pino's serializers are typed as returning an indexable object.
 */
export type RequestCompletionFields = {
  requestId: string | undefined
  method: string
  /** The matched route, never the raw path a member typed. */
  route: string
  statusCode: number
  durationMs: number
  /** Present only when somebody is signed in. */
  memberId?: string
  organizationId?: string
}

/** Everything a member's identity contributes to a log line, or nothing when nobody is. */
export function memberLogFields(
  member: LoggableRequest['member'],
): { memberId: string; organizationId: string } | Record<string, never> {
  if (member === null || member === undefined) return {}
  return { memberId: member.id, organizationId: member.organizationId }
}

/** Rounds a duration to a tenth of a millisecond; anything finer is noise. */
function roundedMilliseconds(elapsed: number | undefined): number {
  return Number.isFinite(elapsed) ? Math.round((elapsed as number) * 10) / 10 : 0
}

/** The fields the "request completed" line carries (spec 09 §5). */
export function requestCompletionFields(reply: LoggableReply): RequestCompletionFields {
  const request = reply.request
  return {
    requestId: typeof request?.id === 'string' ? request.id : undefined,
    method: request?.method ?? 'UNKNOWN',
    route: request?.routeOptions?.url ?? UNMATCHED_ROUTE,
    statusCode: reply.statusCode ?? 0,
    durationMs: roundedMilliseconds(reply.elapsedTime),
    ...memberLogFields(request?.member),
  }
}

/**
 * Application routes live under `/_/`; every other path is a keyword somebody typed, and the
 * resolver's own lines are where a keyword belongs. So the arrival line names the path only
 * when it is an application path.
 */
export function loggablePath(url: string | undefined): string | undefined {
  if (url === undefined) return undefined
  const pathname = url.split(/[?#]/, 1)[0] ?? url
  return pathname.startsWith('/_/') ? pathname : undefined
}

/** The fields the "incoming request" line carries. */
export function requestArrivalFields(request: LoggableRequest): Record<string, unknown> {
  return {
    method: request.method,
    route: request.routeOptions?.url,
    path: loggablePath(request.url),
    host: request.host,
    remoteAddress: request.ip,
    ...memberLogFields(request.member),
  }
}

// --- resolver lines ---------------------------------------------------------

/** What a resolver line reports as having happened (spec 09 §5). */
export type ResolverLogOutcome = 'hit' | 'miss' | 'unserializable'

/**
 * The host a destination points at, which is as much of it as a log line may carry. Falls back
 * to a scheme-and-authority match so that a destination too broken for the URL parser — the one
 * a 502 is answered for (spec 04 §7) — still says where it was aimed.
 */
export function destinationHostOf(destination: string): string | undefined {
  try {
    const host = new URL(destination).host
    if (host.length > 0) return host
  } catch {
    // Falls through to the textual match below.
  }
  const authority = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/.exec(destination)
  const matched = authority?.[1]
  return matched === undefined || matched.length === 0 ? undefined : matched
}

/** Everything a resolver line records about one resolution (spec 09 §5). */
export interface ResolverLogFields {
  namespace: string
  /** The canonical form the lookup used, never the destination. */
  keyword: string
  outcome: ResolverLogOutcome
  /** Only ever the host; a destination can carry secrets in its path and query. */
  destinationHost?: string
}

export function resolverLogFields(fields: {
  namespace: string
  keyword: string
  outcome: ResolverLogOutcome
  destination?: string | undefined
}): ResolverLogFields {
  const host = fields.destination === undefined ? undefined : destinationHostOf(fields.destination)
  return {
    namespace: fields.namespace,
    keyword: fields.keyword,
    outcome: fields.outcome,
    ...(host === undefined ? {} : { destinationHost: host }),
  }
}

// --- the logger itself ------------------------------------------------------

export function buildLoggerOptions(config: DeploymentConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    // Credentials must never reach the log stream, whatever puts them there.
    redact: { paths: [...REDACTED_HEADER_PATHS], remove: true },
    serializers: {
      // Fastify passes the request itself; only the fields spec 09 §5 names come back out.
      req(request: LoggableRequest) {
        return requestArrivalFields(request)
      },
      // Fastify passes the reply, and the reply knows its request, which is where the member,
      // the matched route, and the elapsed time come from.
      res(reply: LoggableReply): { [field: string]: unknown; statusCode?: string | number } {
        return requestCompletionFields(reply)
      },
    },
    // Human readable output while developing; JSON to stdout everywhere else.
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }
      : {}),
  }
}

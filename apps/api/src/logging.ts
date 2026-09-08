// Structured logging and the request id that ties log lines, responses, and error reports
// together (spec 09 §5).

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { DeploymentConfig } from '@golinks/shared/config'
import type { FastifyRequest, FastifyServerOptions } from 'fastify'

export const REQUEST_ID_HEADER = 'x-request-id'

/** Printable ASCII only, so that the value can be echoed back into a response header safely. */
const REQUEST_ID_PATTERN = /^[\x20-\x7e]{1,200}$/

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

export function buildLoggerOptions(config: DeploymentConfig): FastifyServerOptions['logger'] {
  return {
    level: config.logLevel,
    // Credentials must never reach the log stream.
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        'err.config.headers',
      ],
      remove: true,
    },
    serializers: {
      req(request: FastifyRequest) {
        return {
          method: request.method,
          url: request.url,
          route: request.routeOptions?.url,
          host: request.headers.host,
          remoteAddress: request.ip,
        }
      },
      res(reply: { statusCode: number }) {
        return { statusCode: reply.statusCode }
      },
    },
    // Human readable output while developing; JSON to stdout everywhere else.
    ...(config.nodeEnv === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }
      : {}),
  }
}

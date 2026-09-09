// Origin and content-type checks on state-changing requests (spec 02 §6). Together with a
// SameSite=Lax session cookie and JSON-only bodies these remove the need for a CSRF token.

import { type DeploymentConfig, originOfUrl } from '@golinks/shared/config'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ApiError } from '../errors.ts'

export const API_PREFIX = '/_/api'
export const LOGOUT_PATH = '/_/auth/logout'

const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const JSON_CONTENT_TYPE = 'application/json'

/** The path part of a request URL, without the query string. */
export function pathnameOf(url: string): string {
  const queryStart = url.indexOf('?')
  const hashStart = url.indexOf('#')
  const end = Math.min(
    queryStart === -1 ? url.length : queryStart,
    hashStart === -1 ? url.length : hashStart,
  )
  return url.slice(0, end)
}

export function isApiPath(pathname: string): boolean {
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`)
}

/**
 * Whether the Origin check applies. Sign-out is included on GET as well, because spec 02 §4
 * accepts a plain link for it and holds it to the same check.
 */
export function requiresOriginCheck(method: string, pathname: string): boolean {
  if (STATE_CHANGING_METHODS.has(method)) return isApiPath(pathname) || pathname === LOGOUT_PATH
  return method === 'GET' && pathname === LOGOUT_PATH
}

function hasBody(request: FastifyRequest): boolean {
  if (request.headers['transfer-encoding'] !== undefined) return true
  const length = request.headers['content-length']
  return length !== undefined && Number(length) > 0
}

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  return mediaType === JSON_CONTENT_TYPE
}

/**
 * Whether an Origin header names one of the extension origins the deployment lists in
 * `EXTENSION_ORIGINS` (spec 12 §3).
 *
 * Compared as text rather than through the URL helpers: `chrome-extension://` is not an http
 * origin, and the configuration has already normalized both sides to the exact form a browser
 * sends. An empty list — the default — accepts nothing.
 */
function isAllowedExtensionOrigin(header: string, extensionOrigins: readonly string[]): boolean {
  if (extensionOrigins.length === 0) return false
  return extensionOrigins.includes(header.trim().toLowerCase())
}

/**
 * Compares the request's Origin against the canonical origin, or one of the deployment's
 * extension origins, falling back to the Referer when the browser omitted Origin. The Referer
 * fallback knows only the canonical origin: an extension always sends an Origin.
 *
 * Returns the reason the request failed, or undefined when it passed.
 */
export function checkRequestOrigin(
  request: FastifyRequest,
  expectedOrigin: string,
  extensionOrigins: readonly string[] = [],
): string | undefined {
  const originHeader = request.headers.origin
  if (typeof originHeader === 'string' && originHeader !== 'null') {
    if (isAllowedExtensionOrigin(originHeader, extensionOrigins)) return undefined
    const origin = originOfUrl(originHeader)
    return origin === expectedOrigin ? undefined : 'the Origin header does not match this service'
  }
  const refererHeader = request.headers.referer
  if (typeof refererHeader === 'string') {
    const origin = originOfUrl(refererHeader)
    return origin === expectedOrigin ? undefined : 'the Referer header does not match this service'
  }
  return 'the request carried neither an Origin nor a Referer header'
}

export function registerOriginCheck(app: FastifyInstance, config: DeploymentConfig): void {
  const expectedOrigin = config.baseUrl
  const extensionOrigins = config.extensionOrigins

  app.addHook('onRequest', async (request) => {
    const pathname = pathnameOf(request.url)

    if (requiresOriginCheck(request.method, pathname)) {
      const reason = checkRequestOrigin(request, expectedOrigin, extensionOrigins)
      if (reason !== undefined) {
        throw new ApiError('csrf_origin_mismatch', `This request was refused because ${reason}.`, {
          details: { expectedOrigin },
        })
      }
    }

    // Bodies sent to the API are JSON or nothing (spec 02 §6). The resolver ignores bodies.
    if (isApiPath(pathname) && hasBody(request)) {
      const contentType = request.headers['content-type']
      if (!isJsonContentType(contentType)) {
        throw new ApiError(
          'unsupported_media_type',
          'API request bodies must be sent as application/json.',
          { details: { received: contentType ?? null, expected: JSON_CONTENT_TYPE } },
        )
      }
    }
  })
}

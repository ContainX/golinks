/**
 * Transport for the JSON API (spec 05).
 *
 * This module knows how to send a request, unwrap a response, and turn the
 * error envelope into something a caller can branch on. Which endpoints exist,
 * and what they answer with, belongs to the resource modules beside it.
 */

import type { Link } from '@golinks/shared/api'
import { API_BASE_PATH, LinkSchema } from '@golinks/shared/api'

/** Base path of the API (spec 05 §1). */
export { API_BASE_PATH }

/**
 * The endpoint that starts sign-in (spec 02 §2). Owned by the API, never by the
 * client router, so it is reached with a full page load.
 */
export const AUTH_LOGIN_PATH = '/_/auth/login'

/**
 * The client route the API hands the browser to when a provider must be chosen
 * or an error shown (spec 02 §2.1). A 401 raised while this screen is open is
 * the screen's own subject, so it does not start another redirect.
 */
export const SIGN_IN_PATH = '/_/login'

/** Header carrying the id to quote when reporting a problem (spec 05 §1). */
const REQUEST_ID_HEADER = 'X-Request-Id'

/**
 * Body of a failed response (spec 05 §4). `existingLink` accompanies
 * `keyword_exists` and `keyword_conflict`, and is parsed with the shared Link
 * schema so that a caller offering to open or edit the link it names
 * (spec 08 §4) gets the same shape as every other link in the app.
 */
export interface ApiErrorPayload {
  code: string
  message: string
  details?: Record<string, unknown>
  existingLink?: Link
}

/**
 * Code used when a failed response does not carry the documented envelope, for
 * example a proxy error page or a truncated body.
 */
export const UNEXPECTED_RESPONSE_CODE = 'unexpected_response'

/** Codes to assume when the envelope is missing but the status is unambiguous. */
const STATUS_FALLBACK_CODES = new Map<number, string>([
  [401, 'unauthenticated'],
  [403, 'forbidden'],
  [404, 'not_found'],
  [415, 'unsupported_media_type'],
  [429, 'rate_limited'],
  [500, 'internal_error'],
])

/** A response the API refused, carrying the envelope from spec 05 §4. */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined
  /** The link a `keyword_exists` or `keyword_conflict` collided with. */
  readonly existingLink: Link | null
  readonly requestId: string | null

  constructor(status: number, payload: ApiErrorPayload, requestId: string | null = null) {
    super(payload.message)
    this.name = 'ApiError'
    this.status = status
    this.code = payload.code
    this.details = payload.details
    this.existingLink = payload.existingLink ?? null
    this.requestId = requestId
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recognizes `{ error: { code, message, details?, existingLink? } }`.
 *
 * An `existingLink` that does not parse as a Link is dropped rather than
 * carried along half-formed: the message and the code still say what went
 * wrong, and a caller that offers to open the existing link can tell that there
 * is nothing to offer.
 */
function readErrorPayload(body: unknown): ApiErrorPayload | null {
  if (!isRecord(body) || !isRecord(body.error)) {
    return null
  }
  const { code, message, details, existingLink } = body.error
  if (typeof code !== 'string' || typeof message !== 'string') {
    return null
  }
  const parsedLink = existingLink === undefined ? null : LinkSchema.safeParse(existingLink)
  return {
    code,
    message,
    ...(isRecord(details) ? { details } : {}),
    ...(parsedLink?.success ? { existingLink: parsedLink.data } : {}),
  }
}

/**
 * The two things this module needs from `window.location`, behind an
 * indirection. The browser's `Location` object cannot be replaced or patched in
 * the test DOM, so tests substitute the members of this object instead.
 */
export const browserNavigation = {
  /** Where the member is now, in the form `redirectTo` expects (spec 02 §2.2). */
  currentPathAndQuery(): string {
    if (typeof window === 'undefined') {
      return '/'
    }
    return `${window.location.pathname}${window.location.search}`
  },
  /** Leaves the app entirely; the destination is served by the API. */
  navigate(url: string): void {
    if (typeof window === 'undefined') {
      return
    }
    window.location.assign(url)
  },
}

/** The sign-in endpoint with a `redirectTo` that brings the member back here. */
export function authLoginUrl(redirectTo: string): string {
  return `${AUTH_LOGIN_PATH}?${new URLSearchParams({ redirectTo }).toString()}`
}

function redirectToSignIn(): void {
  const redirectTo = browserNavigation.currentPathAndQuery()
  // A 401 raised while the sign-in screen is open would otherwise send the
  // browser to `/_/auth/login`, which hands a member with no session straight
  // back here (spec 02 §2.1) — around and around. The member is already where
  // the redirect would take them, so there is nothing to do.
  if (redirectTo === SIGN_IN_PATH || redirectTo.startsWith(`${SIGN_IN_PATH}?`)) {
    return
  }
  browserNavigation.navigate(authLoginUrl(redirectTo))
}

export interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  /** Serialized as the JSON request body. Mutually exclusive with `body`. */
  json?: unknown
  /** Raw body, for the rare request that is not a JSON document. */
  body?: BodyInit | null
  /**
   * Whether a 401 sends the browser to sign-in. On by default. Turn it off for
   * a request whose whole purpose is to discover whether a session exists,
   * which would otherwise bounce a signed-out member off the sign-in page.
   */
  redirectOnUnauthenticated?: boolean
}

function apiUrl(path: string): string {
  if (!path.startsWith('/')) {
    throw new TypeError(`API path must start with "/", received: ${path}`)
  }
  return `${API_BASE_PATH}${path}`
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    const text = await response.text()
    return text.length === 0 ? null : (JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get(REQUEST_ID_HEADER)
  const payload = readErrorPayload(await readJsonBody(response))
  if (payload) {
    return new ApiError(response.status, payload, requestId)
  }
  return new ApiError(
    response.status,
    {
      code: STATUS_FALLBACK_CODES.get(response.status) ?? UNEXPECTED_RESPONSE_CODE,
      message: `The API responded ${response.status} without an error envelope.`,
    },
    requestId,
  )
}

function hasNoBody(response: Response): boolean {
  return (
    response.status === 204 ||
    response.status === 205 ||
    response.headers.get('Content-Length') === '0'
  )
}

/**
 * Calls the API and returns the parsed response body.
 *
 * `path` is relative to {@link API_BASE_PATH} and must start with `/`. The
 * session cookie rides along, JSON is negotiated in both directions, and a
 * failed response is raised as an {@link ApiError} carrying the code from the
 * envelope. A 401 additionally sends the browser to the sign-in endpoint with
 * the current location as `redirectTo` before the error is raised, so the
 * caller never has to handle "not signed in" itself.
 */
export async function apiFetch<TResult = unknown>(
  path: string,
  init: ApiFetchInit = {},
): Promise<TResult> {
  const { json, body, headers, redirectOnUnauthenticated = true, ...rest } = init

  if (json !== undefined && body !== undefined && body !== null) {
    throw new TypeError('apiFetch accepts either `json` or `body`, not both.')
  }

  const requestHeaders = new Headers(headers)
  requestHeaders.set('Accept', 'application/json')

  let requestBody = body ?? null
  if (json !== undefined) {
    requestBody = JSON.stringify(json)
    requestHeaders.set('Content-Type', 'application/json')
  }

  const response = await fetch(apiUrl(path), {
    ...rest,
    body: requestBody,
    headers: requestHeaders,
    credentials: 'include',
  })

  if (response.status === 401 && redirectOnUnauthenticated) {
    redirectToSignIn()
  }

  if (!response.ok) {
    throw await toApiError(response)
  }

  if (hasNoBody(response)) {
    return undefined as TResult
  }

  return (await response.json()) as TResult
}

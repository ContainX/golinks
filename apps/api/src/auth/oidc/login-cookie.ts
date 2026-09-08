// The short-lived sign-in cookie, `gl_login` (spec 02 §2 step 2).
//
// Between the redirect to the provider and the callback the service has to remember four
// things: which provider the member went to, the `state` and `nonce` it generated, the PKCE
// verifier that proves the callback belongs to the same browser, and where the member was
// trying to go. None of it belongs in the session store — there is no session yet — so it
// travels in a signed, HttpOnly cookie that lives for ten minutes and is cleared as soon as
// the callback is done with it.

import type { DeploymentConfig } from '@golinks/shared/config'
import { LOGIN_COOKIE_NAME } from '@golinks/shared/config'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { DEFAULT_REDIRECT_TO, sanitizeRedirectTo } from '../redirect-to.ts'

export { LOGIN_COOKIE_NAME }

/** Spec 02 §2: an attempt that has not come back within ten minutes has expired. */
export const LOGIN_COOKIE_MAX_AGE_MS = 10 * 60 * 1000

/**
 * The cookie is only ever read by the callback, so it is scoped to the auth routes and never
 * accompanies a request to a keyword or to the API.
 */
export const LOGIN_COOKIE_PATH = '/_/auth'

/** What one sign-in attempt has to remember while the member is at the provider. */
export interface LoginAttempt {
  /** The provider the member was sent to; the callback must be for the same one. */
  providerId: string
  /** The `state` parameter, echoed back by the provider (spec 02 §2 step 3). */
  state: string
  /** The `nonce` the ID token must carry. */
  nonce: string
  /** The PKCE verifier whose S256 challenge went out with the authorization request. */
  codeVerifier: string
  /** Where the member lands once they are signed in, already sanitized (spec 02 §2.2). */
  redirectTo: string
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/** The attempt as it travels: compact JSON, base64url encoded, then signed by the cookie. */
export function encodeLoginAttempt(attempt: LoginAttempt): string {
  const payload = JSON.stringify([
    attempt.providerId,
    attempt.state,
    attempt.nonce,
    attempt.codeVerifier,
    attempt.redirectTo,
  ])
  return Buffer.from(payload, 'utf8').toString('base64url')
}

/**
 * Reads an attempt back, or undefined when the value is not one.
 *
 * `redirectTo` is sanitized again on the way out: the cookie is signed, so it cannot have been
 * rewritten, but a value that was written by an older release must not be able to turn into an
 * open redirect either (spec 02 §2.2).
 */
export function decodeLoginAttempt(value: string): LoginAttempt | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (!Array.isArray(parsed) || parsed.length !== 5) return undefined

  const [providerId, state, nonce, codeVerifier, redirectTo] = parsed as unknown[]
  if (
    !isNonEmptyString(providerId) ||
    !isNonEmptyString(state) ||
    !isNonEmptyString(nonce) ||
    !isNonEmptyString(codeVerifier)
  ) {
    return undefined
  }

  return {
    providerId,
    state,
    nonce,
    codeVerifier,
    redirectTo: sanitizeRedirectTo(redirectTo ?? DEFAULT_REDIRECT_TO),
  }
}

/** Cookie attributes fixed by spec 02 §2 and §3: signed, HttpOnly, SameSite=Lax, ten minutes. */
function cookieOptions(config: DeploymentConfig) {
  return {
    signed: true,
    httpOnly: true,
    secure: config.session.cookieSecure,
    sameSite: 'lax',
    path: LOGIN_COOKIE_PATH,
  } as const
}

/** Writes the attempt the callback will be checked against. */
export function writeLoginAttempt(
  reply: FastifyReply,
  config: DeploymentConfig,
  attempt: LoginAttempt,
): void {
  reply.setCookie(LOGIN_COOKIE_NAME, encodeLoginAttempt(attempt), {
    ...cookieOptions(config),
    maxAge: Math.floor(LOGIN_COOKIE_MAX_AGE_MS / 1000),
  })
}

/**
 * The attempt this request carries, or undefined when there is none, the signature does not
 * hold, or the value is not an attempt. All three are the same refusal to the caller:
 * `login_state_mismatch` (spec 02 §2 step 3).
 */
export function readLoginAttempt(request: FastifyRequest): LoginAttempt | undefined {
  const raw = request.cookies[LOGIN_COOKIE_NAME]
  if (raw === undefined) return undefined

  const unsigned = request.unsignCookie(raw)
  if (!unsigned.valid || unsigned.value === null) return undefined

  return decodeLoginAttempt(unsigned.value)
}

/** Clears the cookie, whichever way the callback ended. */
export function clearLoginAttempt(reply: FastifyReply, config: DeploymentConfig): void {
  const { signed: _signed, ...attributes } = cookieOptions(config)
  reply.clearCookie(LOGIN_COOKIE_NAME, attributes)
}

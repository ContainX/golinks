// Why a sign-in was refused (spec 02 §2.1).
//
// These codes are not API error codes: they name the message the sign-in page shows, and the
// OIDC callback puts them straight into `/_/auth/login?error=<code>`. Endpoints that complete a
// sign-in without a browser round trip — the test sign-in of spec 02 §8 — answer with the
// error envelope instead, so every code also carries the API code it is reported as.

import { ApiError, type ApiErrorCode } from '../errors.ts'

/** Every reason spec 02 §2.1 tabulates, in the order it lists them. */
export const SIGN_IN_ERROR_CODES = [
  'account_disabled',
  'org_not_allowed',
  'email_missing',
  'email_unverified',
  'login_state_mismatch',
  'provider_error',
] as const

export type SignInErrorCode = (typeof SIGN_IN_ERROR_CODES)[number]

/** The message the sign-in page shows for each code (spec 02 §2.1). */
export const SIGN_IN_ERROR_MESSAGES: Readonly<Record<SignInErrorCode, string>> = Object.freeze({
  account_disabled: 'Your account has been disabled by an administrator.',
  org_not_allowed: 'Your organization is not allowed to use this service.',
  email_missing: 'The identity provider did not return an email address.',
  email_unverified: 'Your email address is not verified with the identity provider.',
  login_state_mismatch: 'The sign-in attempt expired or was tampered with. Please try again.',
  provider_error: 'Sign-in failed. Please try again.',
})

/**
 * How each reason is reported when the caller is not a browser being redirected.
 *
 * A refused identity is `forbidden`: the credential was understood and the answer is no. A
 * malformed or unverified identity is a bad request. `login_state_mismatch` belongs to the
 * browser round trip, so it too is a bad request when it surfaces here at all.
 */
const API_CODES: Readonly<Record<SignInErrorCode, ApiErrorCode>> = Object.freeze({
  account_disabled: 'forbidden',
  org_not_allowed: 'forbidden',
  email_missing: 'validation_failed',
  email_unverified: 'validation_failed',
  login_state_mismatch: 'validation_failed',
  provider_error: 'internal_error',
})

export function isSignInErrorCode(value: unknown): value is SignInErrorCode {
  return typeof value === 'string' && (SIGN_IN_ERROR_CODES as readonly string[]).includes(value)
}

export interface SignInErrorOptions {
  /** Overrides the standard message. The sign-in page never shows it; logs and the API do. */
  message?: string
  /** The underlying failure, kept for the log line and never shown to the browser. */
  cause?: unknown
}

/**
 * Thrown by everything on the sign-in path. The OIDC callback catches it and redirects with
 * `error=<code>`; the test sign-in turns it into the error envelope.
 */
export class SignInError extends Error {
  readonly code: SignInErrorCode

  constructor(code: SignInErrorCode, options: SignInErrorOptions = {}) {
    super(options.message ?? SIGN_IN_ERROR_MESSAGES[code], {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    })
    this.name = 'SignInError'
    this.code = code
  }

  /** The message the sign-in page shows, whatever the constructor was told. */
  get displayMessage(): string {
    return SIGN_IN_ERROR_MESSAGES[this.code]
  }

  /** The same refusal as an API error, with the sign-in code kept in `details.reason`. */
  toApiError(): ApiError {
    return new ApiError(API_CODES[this.code], this.displayMessage, {
      details: { reason: this.code },
    })
  }
}

export function isSignInError(value: unknown): value is SignInError {
  return value instanceof SignInError
}

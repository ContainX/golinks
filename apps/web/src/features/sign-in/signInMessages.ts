/**
 * What the sign-in page has to say (spec 02 §2.1).
 *
 * The API never tells the browser what an identity provider actually said —
 * provider errors are logged with a request id and reduced to a code
 * (spec 02 §2 step 4). These are the messages those codes stand for, worded so
 * that a member can tell whether to try again, ask an administrator, or give
 * up on this account.
 */

/** The codes `/_/auth/login?error=` is documented to carry. */
export const SIGN_IN_ERROR_CODES = [
  'account_disabled',
  'org_not_allowed',
  'email_missing',
  'email_unverified',
  'login_state_mismatch',
  'provider_error',
] as const

export type SignInErrorCode = (typeof SIGN_IN_ERROR_CODES)[number]

const MESSAGES: Record<SignInErrorCode, string> = {
  account_disabled: 'Your account has been disabled by an administrator.',
  org_not_allowed: 'Your organization is not allowed to use this service.',
  email_missing: 'The identity provider did not return an email address.',
  email_unverified: 'Your email address is not verified with the identity provider.',
  login_state_mismatch: 'The sign-in attempt expired or was tampered with. Please try again.',
  provider_error: 'Sign-in failed. Please try again.',
}

function isKnownCode(code: string): code is SignInErrorCode {
  return Object.hasOwn(MESSAGES, code)
}

/**
 * The message for a code from the query string.
 *
 * A code this build has never heard of gets the general failure message rather
 * than being shown raw: a deployment running a newer API must not confront a
 * member with an identifier, and "please try again" is true of every one of
 * these.
 */
export function signInErrorMessage(code: string | null): string | null {
  if (code === null || code === '') {
    return null
  }
  return isKnownCode(code) ? MESSAGES[code] : MESSAGES.provider_error
}

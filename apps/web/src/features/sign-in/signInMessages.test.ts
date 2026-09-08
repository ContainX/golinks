import { describe, expect, it } from 'vitest'
import { SIGN_IN_ERROR_CODES, signInErrorMessage } from './signInMessages.ts'

describe('signInErrorMessage', () => {
  it('has a message for every code spec 02 §2.1 documents', () => {
    for (const code of SIGN_IN_ERROR_CODES) {
      const message = signInErrorMessage(code)
      expect(message).toBeTruthy()
      // A member has to be able to act on it; a code is not a message.
      expect(message).not.toContain('_')
    }
  })

  it('says what each failure was', () => {
    expect(signInErrorMessage('account_disabled')).toBe(
      'Your account has been disabled by an administrator.',
    )
    expect(signInErrorMessage('org_not_allowed')).toBe(
      'Your organization is not allowed to use this service.',
    )
    expect(signInErrorMessage('email_missing')).toBe(
      'The identity provider did not return an email address.',
    )
    expect(signInErrorMessage('email_unverified')).toBe(
      'Your email address is not verified with the identity provider.',
    )
    expect(signInErrorMessage('login_state_mismatch')).toBe(
      'The sign-in attempt expired or was tampered with. Please try again.',
    )
    expect(signInErrorMessage('provider_error')).toBe('Sign-in failed. Please try again.')
  })

  it('has nothing to say when nothing went wrong', () => {
    expect(signInErrorMessage(null)).toBeNull()
    expect(signInErrorMessage('')).toBeNull()
  })

  it('falls back to the general failure for a code it has never heard of', () => {
    // A deployment running a newer API must not confront a member with an
    // identifier, and "try again" is true of every one of these.
    expect(signInErrorMessage('some_new_code')).toBe('Sign-in failed. Please try again.')
  })
})

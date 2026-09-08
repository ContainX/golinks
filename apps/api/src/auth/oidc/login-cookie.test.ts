import { describe, expect, it } from 'vitest'
import {
  decodeLoginAttempt,
  encodeLoginAttempt,
  LOGIN_COOKIE_MAX_AGE_MS,
  LOGIN_COOKIE_NAME,
  type LoginAttempt,
} from './login-cookie.ts'

const ATTEMPT: LoginAttempt = {
  providerId: 'okta',
  state: 'state-value',
  nonce: 'nonce-value',
  codeVerifier: 'verifier-value',
  redirectTo: '/handbook?page=2',
}

describe('the sign-in cookie (spec 02 §2 step 2)', () => {
  it('is named and timed the way the spec fixes it', () => {
    expect(LOGIN_COOKIE_NAME).toBe('gl_login')
    expect(LOGIN_COOKIE_MAX_AGE_MS).toBe(10 * 60 * 1000)
  })

  it('carries the whole attempt there and back', () => {
    expect(decodeLoginAttempt(encodeLoginAttempt(ATTEMPT))).toEqual(ATTEMPT)
  })

  it('encodes to something a cookie can hold unescaped', () => {
    expect(encodeLoginAttempt(ATTEMPT)).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('reads nothing out of a value that is not an attempt', () => {
    expect(decodeLoginAttempt('not-base64url-json')).toBeUndefined()
    expect(decodeLoginAttempt(Buffer.from('{}', 'utf8').toString('base64url'))).toBeUndefined()
    expect(decodeLoginAttempt(Buffer.from('[1,2,3]', 'utf8').toString('base64url'))).toBeUndefined()
  })

  it('reads nothing out of an attempt with a piece missing', () => {
    const incomplete = Buffer.from(JSON.stringify(['okta', '', 'n', 'v', '/']), 'utf8').toString(
      'base64url',
    )
    expect(decodeLoginAttempt(incomplete)).toBeUndefined()
  })

  it('sanitizes the path on the way out as well (spec 02 §2.2)', () => {
    const smuggled = encodeLoginAttempt({ ...ATTEMPT, redirectTo: '//evil.test/steal' })

    expect(decodeLoginAttempt(smuggled)?.redirectTo).toBe('/')
  })
})

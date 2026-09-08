import { describe, expect, it } from 'vitest'
import { sanitizeRedirectTo, signInPathWithError } from './redirect-to.ts'

describe('sanitizeRedirectTo', () => {
  it('keeps a path on this service, query and all', () => {
    expect(sanitizeRedirectTo('/go/handbook?via=ext')).toBe('/go/handbook?via=ext')
    expect(sanitizeRedirectTo('/')).toBe('/')
  })

  it('refuses an authority, which is how an open redirect is smuggled in', () => {
    expect(sanitizeRedirectTo('//evil.test/steal')).toBe('/')
    expect(sanitizeRedirectTo('/\\evil.test/steal')).toBe('/')
  })

  it('refuses anything carrying a scheme', () => {
    expect(sanitizeRedirectTo('https://evil.test/')).toBe('/')
    expect(sanitizeRedirectTo('javascript:alert(1)')).toBe('/')
  })

  it('refuses a relative path, which is not rooted at this service', () => {
    expect(sanitizeRedirectTo('go/handbook')).toBe('/')
    expect(sanitizeRedirectTo('')).toBe('/')
  })

  it('refuses control characters and anything that is not a string', () => {
    expect(sanitizeRedirectTo('/go/hand\nLocation: https://evil.test')).toBe('/')
    expect(sanitizeRedirectTo(undefined)).toBe('/')
    expect(sanitizeRedirectTo(['/go'])).toBe('/')
  })

  it('builds the sign-in path an error is shown on', () => {
    expect(signInPathWithError('account_disabled')).toBe('/_/auth/login?error=account_disabled')
  })
})

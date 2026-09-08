import { describe, expect, it } from 'vitest'
import { sanitizeRedirectTo, signInPageLocation, signInPathWithError } from './redirect-to.ts'

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

describe('signInPathWithError', () => {
  it('carries the path a member was trying to reach through the refusal', () => {
    expect(signInPathWithError('provider_error', '/handbook?page=2')).toBe(
      '/_/auth/login?error=provider_error&redirectTo=%2Fhandbook%3Fpage%3D2',
    )
  })

  it('leaves out a path that says nothing', () => {
    expect(signInPathWithError('provider_error', '/')).toBe('/_/auth/login?error=provider_error')
    expect(signInPathWithError('provider_error', '//evil.test')).toBe(
      '/_/auth/login?error=provider_error',
    )
  })
})

describe('signInPageLocation', () => {
  it('is the bare page when there is nothing to say', () => {
    expect(signInPageLocation()).toBe('/_/login')
    expect(signInPageLocation({ redirectTo: '/' })).toBe('/_/login')
  })

  it('carries the path and the error the page has to show (spec 02 §2 step 1)', () => {
    expect(signInPageLocation({ redirectTo: '/handbook', error: 'account_disabled' })).toBe(
      '/_/login?redirectTo=%2Fhandbook&error=account_disabled',
    )
  })

  it('sanitizes the path it carries', () => {
    expect(signInPageLocation({ redirectTo: '//evil.test/steal', error: 'provider_error' })).toBe(
      '/_/login?error=provider_error',
    )
  })
})

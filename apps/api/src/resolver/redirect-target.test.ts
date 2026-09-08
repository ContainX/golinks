import { describe, expect, it } from 'vitest'
import { DEFAULT_REDIRECT_TARGET, sanitizeRedirectTarget } from './redirect-target.ts'

describe('sanitizeRedirectTarget', () => {
  it('keeps a path rooted at this service, query and fragment included', () => {
    expect(sanitizeRedirectTarget('/handbook')).toBe('/handbook')
    expect(sanitizeRedirectTarget('/jira/ACME-1?via=search')).toBe('/jira/ACME-1?via=search')
    expect(sanitizeRedirectTarget('/_/admin/users#roles')).toBe('/_/admin/users#roles')
  })

  it('refuses a protocol-relative target, which addresses another host', () => {
    expect(sanitizeRedirectTarget('//evil.test')).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget('//evil.test/handbook')).toBe(DEFAULT_REDIRECT_TARGET)
  })

  it('refuses a backslash authority, which browsers read as //', () => {
    expect(sanitizeRedirectTarget('/\\evil.test')).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget('/\\/evil.test')).toBe(DEFAULT_REDIRECT_TARGET)
  })

  it('refuses an absolute URL whatever its scheme', () => {
    expect(sanitizeRedirectTarget('https://evil.test')).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget('http://evil.test/handbook')).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget('javascript:alert(1)')).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget('data:text/html,<script>')).toBe(DEFAULT_REDIRECT_TARGET)
  })

  it('refuses a relative path, which has no root to return to', () => {
    expect(sanitizeRedirectTarget('handbook')).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget('../handbook')).toBe(DEFAULT_REDIRECT_TARGET)
  })

  it('refuses a value carrying control characters, which could split the header', () => {
    expect(sanitizeRedirectTarget('/handbook\r\nLocation: https://evil.test')).toBe(
      DEFAULT_REDIRECT_TARGET,
    )
    expect(sanitizeRedirectTarget('/handbook\u0000')).toBe(DEFAULT_REDIRECT_TARGET)
  })

  it('falls back to the root when there is no target at all', () => {
    expect(sanitizeRedirectTarget(undefined)).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget(null)).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget('')).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget('   ')).toBe(DEFAULT_REDIRECT_TARGET)
    expect(sanitizeRedirectTarget(['/handbook'])).toBe(DEFAULT_REDIRECT_TARGET)
  })

  it('keeps a query that merely mentions another URL', () => {
    expect(sanitizeRedirectTarget('/_/?keyword=https://evil.test')).toBe(
      '/_/?keyword=https://evil.test',
    )
  })
})

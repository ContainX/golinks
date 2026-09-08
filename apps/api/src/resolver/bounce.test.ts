import { describe, expect, it } from 'vitest'
import { bounceLocation, isBounceExempt, isCanonicalHost } from './bounce.ts'

const CANONICAL = 'https://links.example.com'

describe('isCanonicalHost', () => {
  it('accepts the canonical host whatever case it was typed in', () => {
    expect(isCanonicalHost('links.example.com', 'links.example.com')).toBe(true)
    expect(isCanonicalHost('LINKS.Example.com', 'links.example.com')).toBe(true)
  })

  it('treats every other name as a short host, port included', () => {
    expect(isCanonicalHost('go', 'links.example.com')).toBe(false)
    expect(isCanonicalHost('links.example.com:8443', 'links.example.com')).toBe(false)
    expect(isCanonicalHost('', 'links.example.com')).toBe(false)
  })

  it('compares the port when the canonical origin names one', () => {
    expect(isCanonicalHost('localhost:3000', 'localhost:3000')).toBe(true)
    expect(isCanonicalHost('localhost', 'localhost:3000')).toBe(false)
  })
})

describe('isBounceExempt', () => {
  it('exempts the health endpoints, which are asked by address', () => {
    expect(isBounceExempt('/_/health')).toBe(true)
    expect(isBounceExempt('/_/health/live')).toBe(true)
    expect(isBounceExempt('/_/health/ready')).toBe(true)
  })

  it('exempts nothing else, not even the rest of the application', () => {
    expect(isBounceExempt('/')).toBe(false)
    expect(isBounceExempt('/_/api/v1/links')).toBe(false)
    expect(isBounceExempt('/_/healthy')).toBe(false)
    expect(isBounceExempt('/handbook')).toBe(false)
  })
})

describe('bounceLocation', () => {
  it('keeps the path and the query exactly as they arrived', () => {
    expect(bounceLocation(CANONICAL, '/jira/ACME-1?via=search')).toBe(
      `${CANONICAL}/jira/ACME-1?via=search`,
    )
    expect(bounceLocation(CANONICAL, '/')).toBe(`${CANONICAL}/`)
  })

  it('leaves encoded characters encoded', () => {
    expect(bounceLocation(CANONICAL, '/jira/a%20b')).toBe(`${CANONICAL}/jira/a%20b`)
  })

  it('roots a path that somehow arrived without one', () => {
    expect(bounceLocation(CANONICAL, 'handbook')).toBe(`${CANONICAL}/handbook`)
  })

  it('drops control characters rather than writing them into a header', () => {
    expect(bounceLocation(CANONICAL, '/handbook\r\nLocation: https://evil.test')).toBe(
      `${CANONICAL}/handbookLocation: https://evil.test`,
    )
  })
})

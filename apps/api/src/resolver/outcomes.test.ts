import { describe, expect, it } from 'vitest'
import { locationHeaderOf, resolverOutcomeOf } from './outcomes.ts'

describe('resolverOutcomeOf', () => {
  it('classifies each response the resolver can send', () => {
    expect(resolverOutcomeOf(302, 'https://wiki.acme.com/handbook')).toBe('hit')
    expect(resolverOutcomeOf(302, '/_/?keyword=nothing-here')).toBe('miss')
    expect(resolverOutcomeOf(302, '/_/auth/login?redirectTo=%2Fhandbook')).toBe('unauthenticated')
    expect(resolverOutcomeOf(502, undefined)).toBe('error')
    expect(resolverOutcomeOf(500, undefined)).toBe('error')
  })

  it('ignores responses that were not resolutions', () => {
    expect(resolverOutcomeOf(404, undefined)).toBeNull()
    expect(resolverOutcomeOf(405, undefined)).toBeNull()
    expect(resolverOutcomeOf(429, undefined)).toBeNull()
    expect(resolverOutcomeOf(302, undefined)).toBeNull()
  })
})

describe('locationHeaderOf', () => {
  it('accepts a string or the first of an array and rejects anything else', () => {
    expect(locationHeaderOf('/x')).toBe('/x')
    expect(locationHeaderOf(['/y', '/z'])).toBe('/y')
    expect(locationHeaderOf(302)).toBeUndefined()
    expect(locationHeaderOf(undefined)).toBeUndefined()
  })
})

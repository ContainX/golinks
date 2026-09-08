import { describe, expect, it } from 'vitest'
import { keywordFromRedirectTo, shortFormOf } from './redirectTo.ts'

describe('keywordFromRedirectTo', () => {
  it('reads the keyword a resolver miss was headed for', () => {
    expect(keywordFromRedirectTo('/handbook')).toBe('handbook')
    expect(keywordFromRedirectTo('/eng/deploy')).toBe('eng/deploy')
    expect(keywordFromRedirectTo('/jira/ACME-123')).toBe('jira/ACME-123')
  })

  it('drops the query and fragment, which are not part of the keyword', () => {
    expect(keywordFromRedirectTo('/handbook?via=search')).toBe('handbook')
    expect(keywordFromRedirectTo('/handbook#section')).toBe('handbook')
  })

  it('names nothing for the paths the app owns (spec 04 §1)', () => {
    expect(keywordFromRedirectTo('/')).toBeNull()
    expect(keywordFromRedirectTo('/_')).toBeNull()
    expect(keywordFromRedirectTo('/_/admin/users')).toBeNull()
    expect(keywordFromRedirectTo('/_/?keyword=nothing')).toBeNull()
  })

  it('names nothing for a value the API would refuse (spec 02 §2.2)', () => {
    expect(keywordFromRedirectTo(null)).toBeNull()
    expect(keywordFromRedirectTo(undefined)).toBeNull()
    expect(keywordFromRedirectTo('')).toBeNull()
    expect(keywordFromRedirectTo('https://evil.example.com/')).toBeNull()
    expect(keywordFromRedirectTo('//evil.example.com/')).toBeNull()
    expect(keywordFromRedirectTo('/\\evil.example.com/')).toBeNull()
  })
})

describe('shortFormOf', () => {
  it('writes a keyword the way a member types it (spec 11)', () => {
    expect(shortFormOf('go', 'handbook')).toBe('go/handbook')
    expect(shortFormOf('links', 'eng/deploy')).toBe('links/eng/deploy')
  })
})

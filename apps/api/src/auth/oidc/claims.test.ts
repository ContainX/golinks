import { describe, expect, it } from 'vitest'
import { identityFromClaims, readGroupClaim } from './claims.ts'

describe('readGroupClaim', () => {
  it('reads a list of names', () => {
    expect(readGroupClaim([' Everyone ', 'GoLinks Admins'])).toEqual(['Everyone', 'GoLinks Admins'])
  })

  it('reads one comma-separated string, which some providers send instead', () => {
    expect(readGroupClaim('Everyone, GoLinks Admins')).toEqual(['Everyone', 'GoLinks Admins'])
  })

  it('reads an empty list as an assertion that there are no groups', () => {
    expect(readGroupClaim([])).toEqual([])
  })

  it('reads an absent claim as no assertion at all', () => {
    expect(readGroupClaim(undefined)).toBeUndefined()
    expect(readGroupClaim(null)).toBeUndefined()
    expect(readGroupClaim(42)).toBeUndefined()
  })

  it('drops entries that are not names', () => {
    expect(readGroupClaim(['Everyone', 7, '', '  '])).toEqual(['Everyone'])
  })
})

describe('identityFromClaims', () => {
  it('prefers the address userinfo returned', () => {
    const identity = identityFromClaims(
      { email: 'fresh@widgets.test', email_verified: true },
      { email: 'stale@widgets.test', email_verified: false },
    )

    expect(identity.email).toBe('fresh@widgets.test')
    // The verification belongs to the source that supplied the address (spec 02 §2 step 5).
    expect(identity.emailVerified).toBe(true)
    expect(identity.emailSource).toBe('userinfo')
  })

  it('falls back to the ID token when userinfo could not be read', () => {
    const identity = identityFromClaims(undefined, { email: 'only@widgets.test' })

    expect(identity.email).toBe('only@widgets.test')
    expect(identity.emailSource).toBe('id_token')
  })

  it('falls back to the ID token when userinfo named no address', () => {
    const identity = identityFromClaims(
      { name: 'Someone' },
      { email: 'only@widgets.test', email_verified: 'false' },
    )

    expect(identity.email).toBe('only@widgets.test')
    expect(identity.emailVerified).toBe('false')
    expect(identity.emailSource).toBe('id_token')
  })

  it('treats a blank address as no address', () => {
    const identity = identityFromClaims({ email: '   ' }, { email: 'real@widgets.test' })

    expect(identity.email).toBe('real@widgets.test')
  })

  it('reports that neither source named one', () => {
    const identity = identityFromClaims({}, {})

    expect(identity.email).toBeUndefined()
    expect(identity.emailSource).toBe('none')
  })

  it('prefers the groups userinfo asserted', () => {
    const identity = identityFromClaims(
      { email: 'someone@widgets.test', groups: ['Everyone'] },
      { email: 'someone@widgets.test', groups: ['GoLinks Admins'] },
    )

    expect(identity.groups).toEqual(['Everyone'])
    expect(identity.groupsSource).toBe('userinfo')
  })

  it('takes the ID token groups when userinfo asserted none', () => {
    const identity = identityFromClaims(
      { email: 'someone@widgets.test' },
      { groups: ['GoLinks Admins'] },
    )

    expect(identity.groups).toEqual(['GoLinks Admins'])
    expect(identity.groupsSource).toBe('id_token')
  })

  it('lets userinfo say the member is in no groups at all', () => {
    const identity = identityFromClaims(
      { email: 'someone@widgets.test', groups: [] },
      {
        groups: ['GoLinks Admins'],
      },
    )

    expect(identity.groups).toEqual([])
    expect(identity.groupsSource).toBe('userinfo')
  })

  it('decides the address and the groups independently of each other', () => {
    const identity = identityFromClaims(
      { groups: ['GoLinks Admins'] },
      { email: 'someone@widgets.test' },
    )

    expect(identity.emailSource).toBe('id_token')
    expect(identity.groupsSource).toBe('userinfo')
  })
})

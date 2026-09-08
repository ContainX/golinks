import { describe, expect, it } from 'vitest'
import {
  extractEmailDomain,
  type OrganizationResolutionConfig,
  resolveOrganizationId,
} from './resolution.ts'

const domainStrategy: OrganizationResolutionConfig = { strategy: 'domain', aliases: {} }

function resolve(email: string, config: OrganizationResolutionConfig = domainStrategy) {
  const result = resolveOrganizationId(email, config)
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`)
  return result.organizationId
}

function reject(email: string, config: OrganizationResolutionConfig) {
  const result = resolveOrganizationId(email, config)
  if (result.ok) throw new Error(`expected "${email}" to be rejected`)
  return result
}

describe('extractEmailDomain', () => {
  it('returns the lowercased domain part', () => {
    expect(extractEmailDomain('Jane@Acme.COM')).toBe('acme.com')
  })

  it('takes the part after the last @', () => {
    expect(extractEmailDomain('"a@b"@acme.com')).toBe('acme.com')
  })

  it('returns null when there is no usable domain', () => {
    expect(extractEmailDomain('jane')).toBeNull()
    expect(extractEmailDomain('jane@')).toBeNull()
    expect(extractEmailDomain('@acme.com')).toBeNull()
  })
})

describe('resolveOrganizationId, domain strategy', () => {
  it('uses the domain of a corporate address', () => {
    expect(resolve('jane@acme.com')).toBe('acme.com')
  })

  it('lowercases and trims the address first', () => {
    expect(resolve('  Jane@ACME.com  ')).toBe('acme.com')
  })

  it('gives each consumer address its own organization', () => {
    expect(resolve('jane@gmail.com')).toBe('jane@gmail.com')
    expect(resolve('jane@yahoo.co.uk')).toBe('jane@yahoo.co.uk')
    expect(resolve('Jane@Outlook.com')).toBe('jane@outlook.com')
  })

  it('keeps two people at the same consumer provider apart', () => {
    expect(resolve('jane@gmail.com')).not.toBe(resolve('john@gmail.com'))
  })

  it('rejects an address with no domain', () => {
    expect(reject('jane', domainStrategy)).toMatchObject({ code: 'org_unresolvable' })
    expect(reject('jane@', domainStrategy)).toMatchObject({ code: 'org_unresolvable' })
  })
})

describe('resolveOrganizationId, fixed strategy', () => {
  const fixed: OrganizationResolutionConfig = {
    strategy: 'fixed',
    fixedId: 'acme',
    aliases: {},
  }

  it('puts every address in the configured organization', () => {
    expect(resolve('jane@acme.com', fixed)).toBe('acme')
    expect(resolve('contractor@partner.example', fixed)).toBe('acme')
    expect(resolve('jane@gmail.com', fixed)).toBe('acme')
  })

  it('lowercases the configured id', () => {
    expect(resolve('jane@acme.com', { ...fixed, fixedId: '  ACME  ' })).toBe('acme')
  })

  it('reports a fixed strategy with no id', () => {
    expect(reject('jane@acme.com', { strategy: 'fixed', aliases: {} })).toMatchObject({
      code: 'org_unresolvable',
    })
    expect(
      reject('jane@acme.com', { strategy: 'fixed', fixedId: '  ', aliases: {} }),
    ).toMatchObject({ code: 'org_unresolvable' })
  })
})

describe('resolveOrganizationId, aliases', () => {
  const aliased: OrganizationResolutionConfig = {
    strategy: 'domain',
    aliases: { 'acme.co.uk': 'acme.com', 'jane@gmail.com': 'acme.com' },
  }

  it('maps a second domain onto an existing organization', () => {
    expect(resolve('bob@acme.co.uk', aliased)).toBe('acme.com')
  })

  it('maps a personal address onto an existing organization', () => {
    expect(resolve('jane@gmail.com', aliased)).toBe('acme.com')
  })

  it('leaves other addresses at the same consumer provider alone', () => {
    expect(resolve('john@gmail.com', aliased)).toBe('john@gmail.com')
  })

  it('leaves unaliased corporate domains alone', () => {
    expect(resolve('jane@acme.com', aliased)).toBe('acme.com')
    expect(resolve('bob@other.example', aliased)).toBe('other.example')
  })

  it('lets a full-address alias override a corporate domain', () => {
    expect(
      resolve('contractor@partner.example', {
        strategy: 'domain',
        aliases: { 'contractor@partner.example': 'acme.com' },
      }),
    ).toBe('acme.com')
  })

  it('applies after the fixed strategy too', () => {
    expect(
      resolve('jane@gmail.com', {
        strategy: 'fixed',
        fixedId: 'acme',
        aliases: { 'jane@gmail.com': 'other' },
      }),
    ).toBe('other')
  })

  it('normalizes alias keys and values', () => {
    expect(
      resolve('bob@Acme.CO.UK', { strategy: 'domain', aliases: { ' ACME.CO.UK ': ' Acme.com ' } }),
    ).toBe('acme.com')
  })

  it('does not chain aliases', () => {
    expect(
      resolve('bob@a.example', {
        strategy: 'domain',
        aliases: { 'a.example': 'b.example', 'b.example': 'c.example' },
      }),
    ).toBe('b.example')
  })

  it('ignores empty alias entries', () => {
    expect(resolve('bob@a.example', { strategy: 'domain', aliases: { 'a.example': '  ' } })).toBe(
      'a.example',
    )
  })

  it('is not confused by inherited object properties', () => {
    expect(resolve('bob@constructor', { strategy: 'domain', aliases: {} })).toBe('constructor')
  })
})

describe('resolveOrganizationId, allowlist', () => {
  it('accepts an organization on the list', () => {
    expect(
      resolve('jane@acme.com', {
        strategy: 'domain',
        aliases: {},
        allowedIds: ['acme.com', 'partner.example'],
      }),
    ).toBe('acme.com')
  })

  it('rejects an organization off the list', () => {
    expect(
      reject('bob@other.example', {
        strategy: 'domain',
        aliases: {},
        allowedIds: ['acme.com'],
      }),
    ).toMatchObject({ code: 'org_not_allowed' })
  })

  it('names the rejected organization in the message', () => {
    const result = reject('bob@other.example', {
      strategy: 'domain',
      aliases: {},
      allowedIds: ['acme.com'],
    })
    expect(result.message).toMatch(/other\.example/)
  })

  it('checks the aliased id, not the pre-alias one', () => {
    expect(
      resolve('bob@acme.co.uk', {
        strategy: 'domain',
        aliases: { 'acme.co.uk': 'acme.com' },
        allowedIds: ['acme.com'],
      }),
    ).toBe('acme.com')

    expect(
      reject('bob@acme.co.uk', {
        strategy: 'domain',
        aliases: { 'acme.co.uk': 'acme.com' },
        allowedIds: ['acme.co.uk'],
      }),
    ).toMatchObject({ code: 'org_not_allowed' })
  })

  it('normalizes the allowlist entries', () => {
    expect(
      resolve('jane@acme.com', { strategy: 'domain', aliases: {}, allowedIds: [' ACME.com '] }),
    ).toBe('acme.com')
  })

  it('treats an absent or empty allowlist as no allowlist', () => {
    expect(resolve('bob@other.example', { strategy: 'domain', aliases: {} })).toBe('other.example')
    expect(resolve('bob@other.example', { strategy: 'domain', aliases: {}, allowedIds: [] })).toBe(
      'other.example',
    )
  })

  it('applies to the fixed strategy too', () => {
    expect(
      reject('jane@acme.com', {
        strategy: 'fixed',
        fixedId: 'acme',
        aliases: {},
        allowedIds: ['other'],
      }),
    ).toMatchObject({ code: 'org_not_allowed' })
  })

  it('gates a consumer address by its full-address organization id', () => {
    expect(
      resolve('jane@gmail.com', {
        strategy: 'domain',
        aliases: {},
        allowedIds: ['jane@gmail.com'],
      }),
    ).toBe('jane@gmail.com')
  })
})

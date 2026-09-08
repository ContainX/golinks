import {
  type OrganizationSettingsInput,
  OrganizationSettingsSchema,
} from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import { parseResolverRequest, splitRequestPath } from './parse.ts'
import {
  appendRemainder,
  buildHitLocation,
  linkPathOf,
  loginLocation,
  missLocation,
  unserializableDestinationPage,
} from './redirect.ts'
import type { ResolvableLink, ResolverHit } from './resolve.ts'

function settings(input: OrganizationSettingsInput = {}) {
  return OrganizationSettingsSchema.parse({ namespaces: ['eng'], ...input })
}

function link(overrides: Partial<ResolvableLink> = {}): ResolvableLink {
  return {
    id: 1,
    namespace: 'go',
    keyword: 'handbook',
    displayKeyword: 'handbook',
    segmentCount: 1,
    placeholderCount: 0,
    destination: 'https://wiki.acme.com/handbook',
    ownerId: 1,
    ...overrides,
  }
}

function hit(overrides: Partial<ResolverHit> = {}): ResolverHit {
  return {
    outcome: 'hit',
    route: 'exact',
    link: link(),
    values: [],
    remainder: [],
    ...overrides,
  }
}

function locationOf(candidate: ResolverHit): string {
  const built = buildHitLocation(candidate)
  if (!built.ok) throw new Error(built.message)
  return built.location
}

describe('buildHitLocation', () => {
  it('serializes a plain destination through the URL parser', () => {
    expect(locationOf(hit())).toBe('https://wiki.acme.com/handbook')
  })

  it('substitutes captured values, each encoded as a URL component', () => {
    const programmatic = hit({
      link: link({ keyword: 'jira/%s', destination: 'https://acme.atlassian.net/browse/%s' }),
      values: ['a b'],
    })

    expect(locationOf(programmatic)).toBe('https://acme.atlassian.net/browse/a%20b')
  })

  it('substitutes several values positionally', () => {
    const programmatic = hit({
      link: link({
        keyword: 'gh/%s/%s',
        destination: 'https://github.com/acme/%s/issues/%s',
      }),
      values: ['web', '42'],
    })

    expect(locationOf(programmatic)).toBe('https://github.com/acme/web/issues/42')
  })

  it('produces an ASCII header for a unicode value', () => {
    const programmatic = hit({
      link: link({ keyword: 'docs/%s', destination: 'https://docs.acme.com/%s' }),
      values: ['café'],
    })

    const location = locationOf(programmatic)
    expect(location).toBe('https://docs.acme.com/caf%C3%A9')
    expect([...location].every((character) => character.charCodeAt(0) < 128)).toBe(true)
  })

  it('turns an internationalized host into its ASCII form', () => {
    const idn = hit({ link: link({ destination: 'https://bücher.example/handbuch' }) })

    expect(locationOf(idn)).toBe('https://xn--bcher-kva.example/handbuch')
  })

  it('reports a destination that cannot be serialized rather than guessing', () => {
    const broken = buildHitLocation(hit({ link: link({ destination: 'https://%s' }) }))

    expect(broken.ok).toBe(false)
  })
})

describe('appendRemainder', () => {
  it('adds nothing when there is no remainder', () => {
    expect(appendRemainder('https://wiki.acme.com/handbook', [])).toBe(
      'https://wiki.acme.com/handbook',
    )
  })

  it('joins the remaining segments onto the destination', () => {
    expect(appendRemainder('https://wiki.acme.com/handbook', ['extra', 'more'])).toBe(
      'https://wiki.acme.com/handbook/extra/more',
    )
  })

  it('does not double the separator when the destination already ends in one', () => {
    expect(appendRemainder('https://wiki.acme.com/handbook/', ['extra'])).toBe(
      'https://wiki.acme.com/handbook/extra',
    )
  })

  it('encodes each segment, so a typed placeholder cannot reach the substitution', () => {
    expect(appendRemainder('https://wiki.acme.com/x', ['%s'])).toBe('https://wiki.acme.com/x/%25s')
  })
})

describe('loginLocation', () => {
  it('carries the path and query the member asked for', () => {
    expect(loginLocation('/jira/ACME-1?via=search')).toBe(
      '/_/auth/login?redirectTo=%2Fjira%2FACME-1%3Fvia%3Dsearch',
    )
  })

  it('falls back to the root for anything that is not a path here', () => {
    expect(loginLocation('//evil.test/handbook')).toBe('/_/auth/login?redirectTo=%2F')
  })
})

describe('missLocation', () => {
  function missFor(path: string, input: OrganizationSettingsInput = {}) {
    return missLocation(parseResolverRequest(splitRequestPath(path), settings(input)))
  }

  it('pre-fills the keyword and leaves out the default namespace', () => {
    expect(missFor('/nothing-here')).toBe('/_/?keyword=nothing-here')
  })

  it('names a namespace that is not the default', () => {
    expect(missFor('/eng/nothing')).toBe('/_/?keyword=nothing&namespace=eng')
  })

  it('keeps the punctuation the member typed even where it does not count', () => {
    expect(missFor('/meeting-notes', { keywords: { punctuationSensitive: false } })).toBe(
      '/_/?keyword=meeting-notes',
    )
  })

  it('encodes a keyword that carries characters a query cannot hold', () => {
    expect(missFor('/a%20b/c')).toBe('/_/?keyword=a+b%2Fc')
  })
})

describe('the page for a destination that will not serialize', () => {
  it('names the link and its owner', () => {
    const page = unserializableDestinationPage('go/handbook', 'ada@acme.com')

    expect(page).toContain('go/handbook')
    expect(page).toContain('ada@acme.com')
    expect(page).toContain('mailto:ada@acme.com')
  })

  it('points at an administrator when the owner cannot be read', () => {
    const page = unserializableDestinationPage('go/handbook', null)

    expect(page).toContain('administrator')
    expect(page).not.toContain('mailto:')
  })

  it('escapes what it names, so a keyword cannot inject markup', () => {
    const page = unserializableDestinationPage('go/<script>x</script>', 'a"b@acme.com')

    expect(page).not.toContain('<script>')
    expect(page).toContain('&lt;script&gt;')
    expect(page).toContain('a&quot;b@acme.com')
  })

  it('spells the link the way a member would type it', () => {
    expect(linkPathOf({ namespace: 'eng', displayKeyword: 'meeting-notes' })).toBe(
      'eng/meeting-notes',
    )
  })
})

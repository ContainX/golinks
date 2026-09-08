import {
  type OrganizationSettingsInput,
  OrganizationSettingsSchema,
} from '@golinks/shared/settings'
import { describe, expect, it, vi } from 'vitest'
import { parseResolverRequest, splitRequestPath } from './parse.ts'
import { buildHitLocation } from './redirect.ts'
import {
  type LinkScope,
  type PrefixQuery,
  type Resolution,
  type ResolvableLink,
  type ResolverLookup,
  resolveRequest,
} from './resolve.ts'

// The organization of spec 04 §9: default namespace `go`, extra namespace `eng`.
function organization(input: OrganizationSettingsInput = {}) {
  return OrganizationSettingsSchema.parse({ namespaces: ['eng'], ...input })
}

const sensitive = organization()
const insensitive = organization({ keywords: { punctuationSensitive: false } })
const fallback = organization({ keywords: { resolutionMode: 'prefixFallback' } })

interface LinkFixture {
  namespace?: string
  keyword: string
  displayKeyword?: string
  destination: string
}

let nextId = 1

function storedLink(fixture: LinkFixture): ResolvableLink {
  const segments = fixture.keyword.split('/')
  return {
    id: nextId++,
    namespace: fixture.namespace ?? 'go',
    keyword: fixture.keyword,
    displayKeyword: fixture.displayKeyword ?? fixture.keyword,
    segmentCount: segments.length,
    placeholderCount: segments.filter((segment) => segment === '%s').length,
    destination: fixture.destination,
    ownerId: 1,
  }
}

/** The queries of spec 04 §5, answered from a list. Every filter the real one applies. */
function inMemoryLookup(fixtures: readonly LinkFixture[]): ResolverLookup & { calls: string[] } {
  const rows = fixtures.map(storedLink)
  const calls: string[] = []
  const inScope = (scope: LinkScope) => (link: ResolvableLink) => link.namespace === scope.namespace

  return {
    calls,
    findExact: async (scope, keyword) => {
      calls.push(`exact:${keyword}`)
      return rows.filter(inScope(scope)).find((link) => link.keyword === keyword) ?? null
    },
    findByPrefix: async (scope, prefix, query: PrefixQuery = {}) => {
      calls.push(`prefix:${prefix}`)
      return rows
        .filter(inScope(scope))
        .filter((link) => link.keyword.split('/')[0] === prefix)
        .filter(
          (link) => query.segmentCount === undefined || link.segmentCount === query.segmentCount,
        )
        .filter((link) => query.programmaticOnly !== true || link.placeholderCount > 0)
        .sort((left, right) => (left.keyword < right.keyword ? -1 : 1))
    },
    findOwnerEmail: async () => 'ada@acme.com',
  }
}

const ACME_LINKS: LinkFixture[] = [
  { keyword: 'handbook', destination: 'https://wiki.acme.com/handbook' },
  { keyword: 'jira/%s', destination: 'https://acme.atlassian.net/browse/%s' },
  { keyword: 'gh/%s/%s', destination: 'https://github.com/acme/%s/issues/%s' },
  { keyword: 'meeting-notes', destination: 'https://docs.acme.com/notes' },
  { namespace: 'eng', keyword: 'deploy', destination: 'https://deploy.acme.com' },
]

/** The same links as an organization that folds punctuation stores them. */
const ACME_LINKS_INSENSITIVE: LinkFixture[] = ACME_LINKS.map((fixture) =>
  fixture.keyword === 'meeting-notes'
    ? { ...fixture, keyword: 'meetingnotes', displayKeyword: 'meeting-notes' }
    : fixture,
)

interface ResolveOutcome {
  resolution: Resolution
  /** The `Location` a hit would carry, or null for a miss. */
  location: string | null
  queries: string[]
}

async function resolve(
  path: string,
  settings = sensitive,
  fixtures = ACME_LINKS,
): Promise<ResolveOutcome> {
  const lookup = inMemoryLookup(fixtures)
  const parsed = parseResolverRequest(splitRequestPath(path), settings)
  const resolution = await resolveRequest(parsed, lookup, {
    organizationId: 'acme.com',
    rules: settings.keywords,
  })
  const built = resolution.outcome === 'hit' ? buildHitLocation(resolution) : undefined
  return {
    resolution,
    location: built?.ok === true ? built.location : null,
    queries: lookup.calls,
  }
}

describe('the worked examples of spec 04 §9, punctuation-sensitive and standard', () => {
  const cases: ReadonlyArray<[string, string | null]> = [
    ['/handbook', 'https://wiki.acme.com/handbook'],
    ['/Handbook', 'https://wiki.acme.com/handbook'],
    ['/handbook/', 'https://wiki.acme.com/handbook'],
    ['/jira/ACME-123', 'https://acme.atlassian.net/browse/ACME-123'],
    ['/jira/a%20b', 'https://acme.atlassian.net/browse/a%20b'],
    ['/gh/web/42', 'https://github.com/acme/web/issues/42'],
    ['/gh/web', null],
    ['/jira', null],
    ['/handbook/extra', null],
    ['/eng/deploy', 'https://deploy.acme.com/'],
    ['/eng/nothing', null],
    ['/eng', null],
    ['/nothing-here', null],
    ['/meetingnotes', null],
    ['/meeting-notes', 'https://docs.acme.com/notes'],
  ]

  it.each(cases)('%s', async (path, expected) => {
    const { location } = await resolve(path)
    expect(location).toBe(expected)
  })
})

describe('the same organization, punctuation-insensitive', () => {
  const cases: ReadonlyArray<[string, string | null]> = [
    ['/meeting-notes', 'https://docs.acme.com/notes'],
    ['/meetingnotes', 'https://docs.acme.com/notes'],
    ['/MEETING_NOTES', 'https://docs.acme.com/notes'],
    ['/jira/2026-roadmap', 'https://acme.atlassian.net/browse/2026-roadmap'],
    ['/handbook', 'https://wiki.acme.com/handbook'],
  ]

  it.each(cases)('%s', async (path, expected) => {
    const { location } = await resolve(path, insensitive, ACME_LINKS_INSENSITIVE)
    expect(location).toBe(expected)
  })
})

describe('prefix fallback', () => {
  it('answers a bare programmatic prefix with the placeholders emptied', async () => {
    const { resolution, location } = await resolve('/jira', fallback)

    expect(resolution.outcome).toBe('hit')
    expect(location).toBe('https://acme.atlassian.net/browse/')
  })

  it('appends the remainder to an exact first segment', async () => {
    const { location } = await resolve('/handbook/extra', fallback)

    expect(location).toBe('https://wiki.acme.com/handbook/extra')
  })

  it('encodes each appended segment rather than reshaping the destination', async () => {
    const { location } = await resolve('/handbook/a%20b/c', fallback)

    expect(location).toBe('https://wiki.acme.com/handbook/a%20b/c')
  })

  it('still prefers a pattern over the fallback', async () => {
    const { resolution, location } = await resolve('/jira/ACME-1', fallback)

    expect(resolution.outcome === 'hit' && resolution.route).toBe('pattern')
    expect(location).toBe('https://acme.atlassian.net/browse/ACME-1')
  })

  it('misses when the first segment names nothing at all', async () => {
    const { resolution } = await resolve('/nothing/here', fallback)

    expect(resolution.outcome).toBe('miss')
  })

  it('takes the first candidate by keyword and warns when a prefix is ambiguous', async () => {
    const logger = { warn: vi.fn() }
    const lookup = inMemoryLookup([
      { keyword: 'jira/%s', destination: 'https://one.acme.com/%s' },
      { keyword: 'jira/%s/%s', destination: 'https://two.acme.com/%s/%s' },
    ])
    const parsed = parseResolverRequest(splitRequestPath('/jira'), fallback)

    const resolution = await resolveRequest(parsed, lookup, {
      organizationId: 'acme.com',
      rules: fallback.keywords,
      logger,
    })

    expect(resolution.outcome === 'hit' && resolution.link.keyword).toBe('jira/%s')
    expect(logger.warn).toHaveBeenCalledTimes(1)
  })
})

describe('the shape of the algorithm', () => {
  it('takes one query for a single-segment exact hit', async () => {
    const { queries } = await resolve('/handbook')
    expect(queries).toEqual(['exact:handbook'])
  })

  it('takes two for a pattern match', async () => {
    const { queries } = await resolve('/jira/ACME-1')
    expect(queries).toEqual(['exact:jira/acme-1', 'prefix:jira'])
  })

  it('takes two in prefix-fallback mode as well, whichever branch answers', async () => {
    expect((await resolve('/jira', fallback)).queries).toEqual(['exact:jira', 'prefix:jira'])
    expect((await resolve('/handbook/extra', fallback)).queries).toEqual([
      'exact:handbook/extra',
      'prefix:handbook',
    ])
  })

  it('asks for nothing beyond the exact lookup when a single segment misses', async () => {
    const { queries } = await resolve('/nothing-here')
    expect(queries).toEqual(['exact:nothing-here'])
  })

  it('never looks outside the namespace it parsed', async () => {
    // `deploy` lives in `eng`; the default namespace must not see it.
    const { resolution } = await resolve('/deploy')
    expect(resolution.outcome).toBe('miss')
  })

  it('orders pattern candidates by keyword so two patterns resolve the same way twice', async () => {
    const fixtures: LinkFixture[] = [
      { keyword: 'docs/%s', destination: 'https://second.acme.com/%s' },
      { keyword: 'docs/api', destination: 'https://first.acme.com' },
    ]
    const { resolution, location } = await resolve('/docs/api', sensitive, fixtures)

    // The exact match wins before ordering matters at all.
    expect(resolution.outcome === 'hit' && resolution.route).toBe('exact')
    expect(location).toBe('https://first.acme.com/')
  })
})

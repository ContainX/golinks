import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type OrganizationSettings,
  type OrganizationSettingsInput,
  OrganizationSettingsSchema,
} from '@golinks/shared/settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OrganizationSettingsService } from '../organizations/settings-service.ts'
import type { ResolvableLink, ResolverLookup } from '../resolver/resolve.ts'
import type { RecordedVisit, VisitRecorder } from '../resolver/visits.ts'
import { buildTestApp, CANONICAL_ORIGIN } from '../testing/fixtures.ts'
import type { CurrentMember, GoLinksApp } from '../types.ts'

let app: GoLinksApp | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

const member: CurrentMember = {
  id: '7',
  email: 'ada@widgets.test',
  organizationId: 'widgets.test',
  role: 'member',
}

/** A settings service with no database behind it. */
function settingsService(input: OrganizationSettingsInput = {}): OrganizationSettingsService {
  const settings: OrganizationSettings = OrganizationSettingsSchema.parse(input)
  return {
    ensureOrganization: async () => {},
    getSettings: async () => settings,
    saveSettings: async () => settings,
    invalidate: () => {},
  }
}

function link(overrides: Partial<ResolvableLink> = {}): ResolvableLink {
  return {
    id: 1,
    namespace: 'go',
    keyword: 'handbook',
    displayKeyword: 'handbook',
    segmentCount: 1,
    placeholderCount: 0,
    destination: 'https://wiki.widgets.test/handbook',
    ownerId: 7,
    ...overrides,
  }
}

/** A lookup that answers from a list held in memory. */
function lookupOf(
  links: readonly ResolvableLink[],
  ownerEmail: string | null = null,
): ResolverLookup {
  return {
    findExact: async (_scope, keyword) => links.find((entry) => entry.keyword === keyword) ?? null,
    findByPrefix: async (_scope, prefix, query = {}) =>
      links
        .filter((entry) => entry.keyword.split('/')[0] === prefix)
        .filter(
          (entry) => query.segmentCount === undefined || entry.segmentCount === query.segmentCount,
        )
        .filter((entry) => query.programmaticOnly !== true || entry.placeholderCount > 0)
        .sort((left, right) => left.keyword.localeCompare(right.keyword)),
    findOwnerEmail: async () => ownerEmail,
  }
}

const emptyLookup = lookupOf([])

interface SignedInOptions {
  lookup?: ResolverLookup
  settings?: OrganizationSettingsInput
  visitRecorder?: VisitRecorder
}

function signedInApp(options: SignedInOptions = {}): Promise<GoLinksApp> {
  const { lookup = emptyLookup, settings = {}, visitRecorder } = options
  return buildTestApp({
    memberResolver: async () => member,
    organizationSettings: settingsService(settings),
    plugins: [
      (instance) => {
        instance.decorate('resolverLookup', lookup)
        if (visitRecorder !== undefined) instance.decorate('visitRecorder', visitRecorder)
      },
    ],
  })
}

describe('keyword route ownership', () => {
  it('owns every path outside the application prefix', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/foo' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/auth/login?redirectTo=%2Ffoo')
  })

  it('refuses other methods with 405 and an Allow header', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'POST', url: '/foo' })

    expect(response.statusCode).toBe(405)
    expect(response.headers.allow).toBe('GET, HEAD')
    expect(response.json().error.code).toBe('method_not_allowed')
  })

  it('treats an unknown application path as missing rather than as a wrong method', async () => {
    app = await buildTestApp()

    const response = await app.inject({
      method: 'DELETE',
      url: '/_/api/v1/links/42',
      headers: { origin: CANONICAL_ORIGIN },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('serves the fixed static files instead of treating them as keywords', async () => {
    app = await buildTestApp()

    const favicon = await app.inject({ method: 'GET', url: '/favicon.ico' })
    const robots = await app.inject({ method: 'GET', url: '/robots.txt' })

    expect(favicon.statusCode).toBe(200)
    expect(robots.statusCode).toBe(200)
    expect(robots.body).toContain('User-agent')
  })

  it('leaves the empty path to the web app rather than resolving it', async () => {
    app = await signedInApp()

    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('answers an application path that reached the catch-all as missing', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/_/nothing/here' })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })
})

describe('the short-host bounce', () => {
  it('sends a request under another name to the canonical host, path and query intact', async () => {
    app = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/jira/ACME-1?via=search',
      headers: { host: 'go' },
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(`${CANONICAL_ORIGIN}/jira/ACME-1?via=search`)
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('bounces the directory and the application routes too', async () => {
    app = await buildTestApp()

    const root = await app.inject({ method: 'GET', url: '/', headers: { host: 'go' } })
    const application = await app.inject({
      method: 'GET',
      url: '/_/admin/users',
      headers: { host: 'go' },
    })

    expect(root.headers.location).toBe(`${CANONICAL_ORIGIN}/`)
    expect(application.headers.location).toBe(`${CANONICAL_ORIGIN}/_/admin/users`)
  })

  it('leaves health probes alone whatever host they are asked on', async () => {
    app = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/_/health/live',
      headers: { host: '10.0.0.7:3000' },
    })

    expect(response.statusCode).toBe(200)
  })

  it('reads X-Forwarded-Host only when the proxy is trusted', async () => {
    app = await buildTestApp({ environment: { TRUST_PROXY: 'true' } })

    const trusted = await app.inject({
      method: 'GET',
      url: '/handbook',
      headers: { 'x-forwarded-host': 'go' },
    })

    expect(trusted.statusCode).toBe(302)
    expect(trusted.headers.location).toBe(`${CANONICAL_ORIGIN}/handbook`)

    await app.close()
    app = await buildTestApp()

    const ignored = await app.inject({
      method: 'GET',
      url: '/handbook',
      headers: { 'x-forwarded-host': 'go' },
    })

    expect(ignored.headers.location).toBe('/_/auth/login?redirectTo=%2Fhandbook')
  })

  it('answers before the Origin check, on any method', async () => {
    app = await buildTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/_/api/v1/links',
      headers: { host: 'go' },
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(`${CANONICAL_ORIGIN}/_/api/v1/links`)
  })
})

describe('the authentication gate', () => {
  it('sends an unauthenticated member to sign-in with the keyword to come back to', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/jira/ACME-1?via=ext' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/auth/login?redirectTo=%2Fjira%2FACME-1%3Fvia%3Dext')
    expect(response.headers['cache-control']).toBe('no-store')
  })
})

describe('answering a resolved keyword', () => {
  it('redirects to the destination with the headers of spec 04 §7', async () => {
    app = await signedInApp({ lookup: lookupOf([link()]) })

    const response = await app.inject({ method: 'GET', url: '/handbook' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('https://wiki.widgets.test/handbook')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
  })

  it('answers HEAD exactly as GET, without a body', async () => {
    app = await signedInApp({ lookup: lookupOf([link()]) })

    const head = await app.inject({ method: 'HEAD', url: '/handbook' })

    expect(head.statusCode).toBe(302)
    expect(head.headers.location).toBe('https://wiki.widgets.test/handbook')
    expect(head.body).toBe('')
  })

  it('sends a miss to the directory with the keyword pre-filled', async () => {
    app = await signedInApp()

    const response = await app.inject({ method: 'GET', url: '/meeting-notes' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/?keyword=meeting-notes')
    expect(response.headers['cache-control']).toBe('no-store')
  })

  it('names the namespace on a miss outside the default one', async () => {
    app = await signedInApp({ settings: { namespaces: ['eng'] } })

    const response = await app.inject({ method: 'GET', url: '/eng/nothing' })

    expect(response.headers.location).toBe('/_/?keyword=nothing&namespace=eng')
  })

  it('answers 502 with the link and its owner when a destination will not serialize', async () => {
    const broken = link({ destination: 'https://%s', keyword: 'broken', displayKeyword: 'broken' })
    app = await signedInApp({ lookup: lookupOf([broken], 'ada@widgets.test') })

    const response = await app.inject({ method: 'GET', url: '/broken' })

    expect(response.statusCode).toBe(502)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('go/broken')
    expect(response.body).toContain('ada@widgets.test')
  })
})

describe('recording the visit', () => {
  function recorder(): VisitRecorder & { visits: RecordedVisit[] } {
    const visits: RecordedVisit[] = []
    return {
      visits,
      record: (visit) => {
        visits.push(visit)
      },
      settled: async () => {},
    }
  }

  it('records the hit with the member, the organization, and the default source', async () => {
    const visitRecorder = recorder()
    app = await signedInApp({ lookup: lookupOf([link()]), visitRecorder })

    await app.inject({ method: 'GET', url: '/handbook' })
    await app.visitRecorder.settled()

    expect(visitRecorder.visits).toEqual([
      { linkId: 1, organizationId: 'widgets.test', userId: 7, via: 'browser' },
    ])
  })

  it('takes the access source from the via parameter and ignores anything else', async () => {
    const visitRecorder = recorder()
    app = await signedInApp({ lookup: lookupOf([link()]), visitRecorder })

    await app.inject({ method: 'GET', url: '/handbook?via=search' })
    await app.inject({ method: 'GET', url: '/handbook?via=telepathy&utm_source=x' })

    expect(visitRecorder.visits.map((visit) => visit.via)).toEqual(['search', 'browser'])
  })

  it('records nothing for a miss', async () => {
    const visitRecorder = recorder()
    app = await signedInApp({ visitRecorder })

    await app.inject({ method: 'GET', url: '/nothing-here' })

    expect(visitRecorder.visits).toEqual([])
  })

  it('leaves the redirect alone when recording throws', async () => {
    const failing: VisitRecorder = {
      record: () => {
        throw new Error('the visit store is down')
      },
      settled: async () => {},
    }
    app = await signedInApp({ lookup: lookupOf([link()]), visitRecorder: failing })

    const response = await app.inject({ method: 'GET', url: '/handbook' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('https://wiki.widgets.test/handbook')
  })
})

describe('organization settings on the hot path', () => {
  it('reads them once per request', async () => {
    const getSettings = vi.fn(async () => DEFAULT_ORGANIZATION_SETTINGS)
    app = await buildTestApp({
      memberResolver: async () => member,
      organizationSettings: { ...settingsService(), getSettings },
      plugins: [
        (instance) => {
          instance.decorate('resolverLookup', lookupOf([link()]))
        },
      ],
    })

    await app.inject({ method: 'GET', url: '/handbook' })

    expect(getSettings).toHaveBeenCalledTimes(1)
    expect(getSettings).toHaveBeenCalledWith('widgets.test')
  })
})

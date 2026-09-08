import { describe, expect, it } from 'vitest'
import {
  buildLoggerOptions,
  createRequestIdGenerator,
  destinationHostOf,
  loggablePath,
  memberLogFields,
  REDACTED_HEADER_PATHS,
  readRequestIdHeader,
  requestArrivalFields,
  requestCompletionFields,
  resolverLogFields,
} from './logging.ts'
import { testConfig } from './testing/fixtures.ts'

const MEMBER = { id: '42', organizationId: 'widgets.test' }

describe('request id', () => {
  it('accepts a well formed header and refuses anything else', () => {
    expect(readRequestIdHeader(' abc-123 ')).toBe('abc-123')
    expect(readRequestIdHeader(['first', 'second'])).toBe('first')
    expect(readRequestIdHeader(undefined)).toBeUndefined()
    expect(readRequestIdHeader('line\nbreak')).toBeUndefined()
    expect(readRequestIdHeader('x'.repeat(201))).toBeUndefined()
  })

  it('takes the caller’s id only behind a trusted proxy', () => {
    const headers = { 'x-request-id': 'from-the-edge' }
    const trusting = createRequestIdGenerator(true)
    const suspicious = createRequestIdGenerator(false)

    expect(trusting({ headers } as never)).toBe('from-the-edge')
    expect(suspicious({ headers } as never)).not.toBe('from-the-edge')
  })
})

describe('request completion fields', () => {
  it('carries everything spec 09 §5 asks for when a member is signed in', () => {
    const fields = requestCompletionFields({
      statusCode: 302,
      elapsedTime: 3.456,
      request: {
        id: 'req-1',
        method: 'GET',
        url: '/handbook?via=browser',
        routeOptions: { url: '/*' },
        member: MEMBER,
      },
    })

    expect(fields).toEqual({
      requestId: 'req-1',
      method: 'GET',
      route: '/*',
      statusCode: 302,
      durationMs: 3.5,
      memberId: '42',
      organizationId: 'widgets.test',
    })
  })

  it('reports the matched route rather than the keyword that was typed', () => {
    const fields = requestCompletionFields({
      statusCode: 302,
      request: { method: 'GET', url: '/go/secret-project-plan', routeOptions: { url: '/*' } },
    })

    expect(fields.route).toBe('/*')
    expect(JSON.stringify(fields)).not.toContain('secret-project-plan')
  })

  it('leaves the member fields out when nobody is signed in', () => {
    const fields = requestCompletionFields({
      statusCode: 200,
      request: { method: 'GET', routeOptions: { url: '/_/api/v1/links' }, member: null },
    })

    expect(fields.memberId).toBeUndefined()
    expect(fields.organizationId).toBeUndefined()
    expect(fields.route).toBe('/_/api/v1/links')
  })

  it('labels a request that matched no route rather than naming its path', () => {
    const fields = requestCompletionFields({ statusCode: 404, request: { method: 'PUT' } })
    expect(fields).toMatchObject({ route: 'unmatched', method: 'PUT', durationMs: 0 })
  })

  it('reports a member on its own', () => {
    expect(memberLogFields(MEMBER)).toEqual({ memberId: '42', organizationId: 'widgets.test' })
    expect(memberLogFields(null)).toEqual({})
    expect(memberLogFields(undefined)).toEqual({})
  })
})

describe('request arrival fields', () => {
  it('names an application path and never a keyword', () => {
    expect(loggablePath('/_/api/v1/links?cursor=abc')).toBe('/_/api/v1/links')
    expect(loggablePath('/go/handbook')).toBeUndefined()
    expect(loggablePath(undefined)).toBeUndefined()

    const fields = requestArrivalFields({
      method: 'GET',
      url: '/handbook',
      host: 'links.example.com',
      ip: '203.0.113.4',
      routeOptions: { url: '/*' },
    })
    expect(fields).toEqual({
      method: 'GET',
      route: '/*',
      path: undefined,
      host: 'links.example.com',
      remoteAddress: '203.0.113.4',
    })
  })
})

describe('resolver log fields', () => {
  it('records only the host of a destination', () => {
    expect(
      resolverLogFields({
        namespace: 'go',
        keyword: 'jira/%s',
        outcome: 'hit',
        destination: 'https://acme.atlassian.net/browse/SECRET-1?token=abcd',
      }),
    ).toEqual({
      namespace: 'go',
      keyword: 'jira/%s',
      outcome: 'hit',
      destinationHost: 'acme.atlassian.net',
    })
  })

  it('leaves the host out of a miss, which has no destination', () => {
    expect(resolverLogFields({ namespace: 'go', keyword: 'nowhere', outcome: 'miss' })).toEqual({
      namespace: 'go',
      keyword: 'nowhere',
      outcome: 'miss',
    })
  })

  it('still finds the host of a destination the URL parser refuses', () => {
    expect(destinationHostOf('https://wiki.acme.com/a b')).toBe('wiki.acme.com')
    expect(destinationHostOf('https://wiki.acme.com:8443/x')).toBe('wiki.acme.com:8443')
    expect(destinationHostOf('https://user:secret@wiki.acme.com/x')).toBe('wiki.acme.com')
    expect(destinationHostOf('not a url at all')).toBeUndefined()
    expect(destinationHostOf('https://')).toBeUndefined()
  })
})

describe('logger options', () => {
  it('removes the credential headers wherever they appear', () => {
    const options = buildLoggerOptions(testConfig())
    expect(options).toMatchObject({ redact: { paths: [...REDACTED_HEADER_PATHS], remove: true } })
    expect(REDACTED_HEADER_PATHS).toContain('req.headers.authorization')
    expect(REDACTED_HEADER_PATHS).toContain('req.headers.cookie')
    expect(REDACTED_HEADER_PATHS).toContain('res.headers["set-cookie"]')
  })

  it('serializes a reply through the completion builder', () => {
    const options = buildLoggerOptions(testConfig())
    const serializers = (options as { serializers: Record<string, (value: unknown) => unknown> })
      .serializers

    expect(
      serializers.res?.({
        statusCode: 204,
        elapsedTime: 1,
        request: { id: 'req-9', method: 'POST', routeOptions: { url: '/_/auth/test-login' } },
      }),
    ).toMatchObject({ requestId: 'req-9', route: '/_/auth/test-login', statusCode: 204 })
  })
})

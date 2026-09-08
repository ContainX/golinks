import { LinkListQuerySchema, LinkSchema, MeSchema } from '@golinks/shared/api'
import { OrganizationSettingsSchema } from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import { linkFixture } from '../test/fixtures.ts'
import {
  buildQuery,
  parseResponse,
  RequestValidationError,
  ResponseValidationError,
  requestInit,
} from './resource.ts'

describe('buildQuery', () => {
  it('is empty when nothing was asked for', () => {
    expect(buildQuery(LinkListQuerySchema, {}, 'GET /links')).toBe('')
  })

  it('writes each value the way the API reads it back', () => {
    const query = buildQuery(
      LinkListQuerySchema,
      { q: 'notes', programmatic: false, limit: 25, sort: 'keyword' },
      'GET /links',
    )

    expect(query).toBe('?limit=25&programmatic=false&q=notes&sort=keyword')
  })

  it('drops a filter that is absent, null, or cleared', () => {
    const query = buildQuery(
      LinkListQuerySchema,
      { q: '', namespace: undefined, owner: null, cursor: 'c1' },
      'GET /links',
    )

    expect(query).toBe('?cursor=c1')
  })

  it('orders parameters the same way however the caller wrote them', () => {
    const one = buildQuery(LinkListQuerySchema, { sort: 'keyword', q: 'notes' }, 'GET /links')
    const other = buildQuery(LinkListQuerySchema, { q: 'notes', sort: 'keyword' }, 'GET /links')

    expect(one).toBe(other)
  })

  it('refuses a parameter the API would reject, before the request is sent', () => {
    expect(() => buildQuery(LinkListQuerySchema, { limit: 5000 }, 'GET /links')).toThrow(
      RequestValidationError,
    )
    expect(() => buildQuery(LinkListQuerySchema, { sort: 'sideways' }, 'GET /links')).toThrow(
      RequestValidationError,
    )
    // A misspelled parameter would be silently ignored by a permissive schema.
    expect(() => buildQuery(LinkListQuerySchema, { namesapce: 'eng' }, 'GET /links')).toThrow(
      RequestValidationError,
    )
  })

  it('names the endpoint and the offending parameter in the message', () => {
    const error = (() => {
      try {
        buildQuery(LinkListQuerySchema, { limit: 5000 }, 'GET /links')
      } catch (thrown) {
        return thrown as RequestValidationError
      }
      throw new Error('expected a rejection')
    })()

    expect(error.message).toContain('GET /links')
    expect(error.message).toContain('limit')
    expect(error.issues).toHaveLength(1)
  })
})

describe('parseResponse', () => {
  it('returns the parsed resource', () => {
    const link = linkFixture()

    expect(parseResponse(LinkSchema, link, 'Link')).toEqual(link)
  })

  it('applies the schema defaults a sparse document leaves out', () => {
    const settings = parseResponse(OrganizationSettingsSchema, {}, 'organization settings')

    expect(settings.defaultNamespace).toBe('go')
    expect(settings.branding.title).toBe('GoLinks')
  })

  it('rejects a response that does not match the contract, naming the resource', () => {
    const error = (() => {
      try {
        parseResponse(MeSchema, { user: { id: '7' } }, 'Me')
      } catch (thrown) {
        return thrown as ResponseValidationError
      }
      throw new Error('expected a rejection')
    })()

    expect(error).toBeInstanceOf(ResponseValidationError)
    expect(error.message).toContain('Me')
    expect(error.body).toEqual({ user: { id: '7' } })
    expect(error.issues.length).toBeGreaterThan(0)
  })

  it('rejects a link whose timestamps are not timestamps', () => {
    expect(() =>
      parseResponse(LinkSchema, linkFixture({ createdAt: 'yesterday' }), 'Link'),
    ).toThrow(ResponseValidationError)
  })
})

describe('requestInit', () => {
  it('passes an abort signal through to the transport', () => {
    const controller = new AbortController()

    expect(requestInit({ signal: controller.signal }, { method: 'POST' })).toEqual({
      method: 'POST',
      signal: controller.signal,
    })
  })

  it('leaves the transport defaults alone when nothing was asked for', () => {
    expect(requestInit({})).toEqual({})
  })
})

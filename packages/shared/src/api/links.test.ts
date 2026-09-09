import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUGGESTION_LIMIT,
  LinkCreateBodySchema,
  LinkIdParamsSchema,
  LinkListQuerySchema,
  LinkListResponseSchema,
  LinkPatchBodySchema,
  LinkSchema,
  LinkSuggestionsQuerySchema,
  LinkSuggestionsResponseSchema,
  LinkSummarySchema,
  MAX_SUGGESTION_LIMIT,
} from './links.ts'

/** The example from spec 05 section 2.1. */
const specLink = {
  id: '42',
  namespace: 'go',
  keyword: 'meetingnotes',
  displayKeyword: 'meeting-notes',
  fullPath: 'go/meeting-notes',
  destination: 'https://docs.acme.com/notes',
  isProgrammatic: false,
  placeholderCount: 0,
  isUnlisted: false,
  owner: { id: '7', email: 'jane@acme.com' },
  visitCount: 128,
  lastVisitedAt: '2026-09-07T14:03:00Z',
  createdAt: '2026-01-10T09:00:00Z',
  updatedAt: '2026-08-30T16:20:00Z',
  permissions: { canEditDestination: true, canEdit: true, canDelete: true, canTransfer: true },
}

describe('LinkSchema', () => {
  it('parses the resource from the spec', () => {
    expect(LinkSchema.parse(specLink)).toEqual(specLink)
  })

  it('allows a link that has never been visited', () => {
    expect(
      LinkSchema.parse({ ...specLink, visitCount: 0, lastVisitedAt: null }).lastVisitedAt,
    ).toBeNull()
  })

  it('requires the permissions object', () => {
    const { permissions: _permissions, ...withoutPermissions } = specLink
    expect(LinkSchema.safeParse(withoutPermissions).success).toBe(false)
  })

  it('requires the owner summary to carry an id and an email', () => {
    expect(LinkSchema.safeParse({ ...specLink, owner: { id: '7' } }).success).toBe(false)
    expect(LinkSchema.safeParse({ ...specLink, owner: { id: '7', email: 'jane' } }).success).toBe(
      false,
    )
  })

  it('rejects a negative visit count', () => {
    expect(LinkSchema.safeParse({ ...specLink, visitCount: -1 }).success).toBe(false)
  })
})

describe('LinkSummarySchema', () => {
  it('keeps just what a transfer preview shows', () => {
    expect(
      LinkSummarySchema.parse({
        id: '42',
        fullPath: 'go/meeting-notes',
        destination: 'https://docs.acme.com/notes',
        owner: { id: '7', email: 'jane@acme.com' },
      }).fullPath,
    ).toBe('go/meeting-notes')
  })
})

describe('LinkCreateBodySchema', () => {
  it('defaults isUnlisted to false and leaves namespace to the organization', () => {
    expect(
      LinkCreateBodySchema.parse({ keyword: 'handbook', destination: 'docs.acme.com/handbook' }),
    ).toEqual({
      keyword: 'handbook',
      destination: 'docs.acme.com/handbook',
      isUnlisted: false,
    })
  })

  it('accepts every documented field', () => {
    expect(
      LinkCreateBodySchema.parse({
        namespace: 'eng',
        keyword: 'jira/%s',
        destination: 'https://jira.acme.com/browse/%s',
        isUnlisted: true,
        ownerId: '7',
      }),
    ).toEqual({
      namespace: 'eng',
      keyword: 'jira/%s',
      destination: 'https://jira.acme.com/browse/%s',
      isUnlisted: true,
      ownerId: '7',
    })
  })

  it('trims the keyword and the destination', () => {
    const body = LinkCreateBodySchema.parse({
      keyword: '  handbook  ',
      destination: '  https://docs.acme.com/handbook  ',
    })
    expect(body.keyword).toBe('handbook')
    expect(body.destination).toBe('https://docs.acme.com/handbook')
  })

  it('rejects an unknown field', () => {
    const result = LinkCreateBodySchema.safeParse({
      keyword: 'handbook',
      destination: 'https://docs.acme.com/handbook',
      owner: '7',
    })
    expect(result.success).toBe(false)
  })

  it.each([
    ['no keyword', { destination: 'https://docs.acme.com' }],
    ['no destination', { keyword: 'handbook' }],
    ['an empty keyword', { keyword: '   ', destination: 'https://docs.acme.com' }],
    ['an empty destination', { keyword: 'handbook', destination: '' }],
    ['a non-string keyword', { keyword: 7, destination: 'https://docs.acme.com' }],
  ])('rejects a body with %s', (_label, body) => {
    expect(LinkCreateBodySchema.safeParse(body).success).toBe(false)
  })
})

describe('LinkPatchBodySchema', () => {
  it('accepts a single field', () => {
    expect(LinkPatchBodySchema.parse({ destination: 'https://docs.acme.com/new' })).toEqual({
      destination: 'https://docs.acme.com/new',
    })
  })

  it('accepts the full editable subset', () => {
    const body = {
      destination: 'https://docs.acme.com/new',
      keyword: 'handbook',
      namespace: 'eng',
      isUnlisted: true,
      ownerId: '9',
    }
    expect(LinkPatchBodySchema.parse(body)).toEqual(body)
  })

  it('rejects an empty body', () => {
    expect(LinkPatchBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects an unknown field', () => {
    expect(LinkPatchBodySchema.safeParse({ visitCount: 0 }).success).toBe(false)
  })

  it('rejects a null used to clear a field', () => {
    expect(LinkPatchBodySchema.safeParse({ ownerId: null }).success).toBe(false)
  })
})

describe('LinkListQuerySchema', () => {
  it('applies the defaults from spec 03 section 10.1', () => {
    expect(LinkListQuerySchema.parse({})).toEqual({ sort: 'visits', order: 'desc', limit: 50 })
  })

  it('reads every documented parameter off a query string', () => {
    expect(
      LinkListQuerySchema.parse({
        q: 'notes',
        namespace: 'eng',
        destination: 'https://docs.acme.com/notes',
        owner: 'me',
        programmatic: 'true',
        sort: 'keyword',
        order: 'asc',
        limit: '10',
        cursor: 'eyJ2IjoxfQ',
      }),
    ).toEqual({
      q: 'notes',
      namespace: 'eng',
      destination: 'https://docs.acme.com/notes',
      owner: 'me',
      programmatic: true,
      sort: 'keyword',
      order: 'asc',
      limit: 10,
      cursor: 'eyJ2IjoxfQ',
    })
  })

  it('trims the destination filter and leaves it absent when unasked', () => {
    expect(LinkListQuerySchema.parse({ destination: '  https://docs.acme.com/notes ' })).toEqual({
      destination: 'https://docs.acme.com/notes',
      sort: 'visits',
      order: 'desc',
      limit: 50,
    })
    expect(LinkListQuerySchema.parse({}).destination).toBeUndefined()
  })

  it('keeps a destination whole, query string and fragment included', () => {
    const destination = 'https://docs.acme.com/notes?tab=1#today'

    expect(LinkListQuerySchema.parse({ destination }).destination).toBe(destination)
  })

  it('refuses a destination filter that is blank or longer than the column', () => {
    expect(LinkListQuerySchema.safeParse({ destination: '   ' }).success).toBe(false)
    expect(LinkListQuerySchema.safeParse({ destination: 'x'.repeat(4097) }).success).toBe(false)
    expect(LinkListQuerySchema.safeParse({ destination: 'x'.repeat(4096) }).success).toBe(true)
  })

  it('leaves programmatic absent when it is omitted, meaning both kinds', () => {
    expect(LinkListQuerySchema.parse({}).programmatic).toBeUndefined()
  })

  it('caps the limit at 200', () => {
    expect(LinkListQuerySchema.parse({ limit: '200' }).limit).toBe(200)
    expect(LinkListQuerySchema.safeParse({ limit: '201' }).success).toBe(false)
  })

  it.each([
    ['an unknown sort column', { sort: 'owner' }],
    ['an unknown order', { order: 'descending' }],
    ['a programmatic value that is not true or false', { programmatic: '1' }],
    ['an unknown parameter', { page: '2' }],
  ])('rejects %s', (_label, query) => {
    expect(LinkListQuerySchema.safeParse(query).success).toBe(false)
  })
})

describe('LinkSuggestionsQuerySchema', () => {
  it('defaults the limit to five', () => {
    expect(LinkSuggestionsQuerySchema.parse({ keyword: 'handbok' })).toEqual({
      keyword: 'handbok',
      limit: DEFAULT_SUGGESTION_LIMIT,
    })
  })

  it('requires a keyword', () => {
    expect(LinkSuggestionsQuerySchema.safeParse({ namespace: 'go' }).success).toBe(false)
  })

  it('caps the limit', () => {
    expect(
      LinkSuggestionsQuerySchema.parse({ keyword: 'a', limit: String(MAX_SUGGESTION_LIMIT) }).limit,
    ).toBe(MAX_SUGGESTION_LIMIT)
    expect(
      LinkSuggestionsQuerySchema.safeParse({
        keyword: 'a',
        limit: String(MAX_SUGGESTION_LIMIT + 1),
      }).success,
    ).toBe(false)
  })

  it('rejects an unknown parameter', () => {
    expect(
      LinkSuggestionsQuerySchema.safeParse({ keyword: 'a', minSimilarity: '0.5' }).success,
    ).toBe(false)
  })
})

describe('LinkIdParamsSchema', () => {
  it('takes the id from the path', () => {
    expect(LinkIdParamsSchema.parse({ id: '42' })).toEqual({ id: '42' })
  })

  it('rejects an empty id', () => {
    expect(LinkIdParamsSchema.safeParse({ id: '' }).success).toBe(false)
  })
})

describe('list responses', () => {
  it('wraps links in the standard envelope', () => {
    expect(LinkListResponseSchema.parse({ items: [specLink], nextCursor: null })).toEqual({
      items: [specLink],
      nextCursor: null,
    })
  })

  it('returns suggestions without a cursor', () => {
    expect(LinkSuggestionsResponseSchema.parse({ items: [specLink] })).toEqual({
      items: [specLink],
    })
  })
})

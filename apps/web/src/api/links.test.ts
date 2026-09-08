import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import { linkFixture, transferFixture } from '../test/fixtures.ts'
import {
  createLink,
  createTransfer,
  deleteLink,
  getLink,
  listLinks,
  patchLink,
  suggestLinks,
} from './links.ts'
import { RequestValidationError, ResponseValidationError } from './resource.ts'

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('listLinks', () => {
  it('asks for the whole directory when no filter is given', async () => {
    const page = { items: [linkFixture()], nextCursor: null }
    const fetchMock = stubFetch(jsonResponse(page))

    await expect(listLinks()).resolves.toEqual(page)
    expect(requestAt(fetchMock)).toMatchObject({ url: '/_/api/v1/links', method: 'GET' })
  })

  it('writes the directory filters onto the query string (spec 03 §10.1)', async () => {
    const fetchMock = stubFetch(jsonResponse({ items: [], nextCursor: null }))

    await listLinks({
      q: 'notes',
      namespace: 'eng',
      owner: 'me',
      programmatic: true,
      sort: 'keyword',
      order: 'asc',
      limit: 25,
    })

    expect(requestAt(fetchMock).url).toBe(
      '/_/api/v1/links?limit=25&namespace=eng&order=asc&owner=me&programmatic=true&q=notes&sort=keyword',
    )
  })

  it('follows the cursor the previous page handed back', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ items: [linkFixture()], nextCursor: 'page-2' }),
      jsonResponse({ items: [linkFixture({ id: '43' })], nextCursor: null }),
    )

    const first = await listLinks({ sort: 'keyword' })
    const second = await listLinks({ sort: 'keyword', cursor: first.nextCursor ?? undefined })

    expect(requestAt(fetchMock, 1).url).toBe('/_/api/v1/links?cursor=page-2&sort=keyword')
    expect(second.nextCursor).toBeNull()
  })

  it('rejects a listing whose links do not match the contract', async () => {
    stubFetch(jsonResponse({ items: [{ id: '42' }], nextCursor: null }))

    await expect(listLinks()).rejects.toBeInstanceOf(ResponseValidationError)
  })

  it('rejects a page size the API would refuse, without asking it', async () => {
    const fetchMock = stubFetch(jsonResponse({ items: [], nextCursor: null }))

    await expect(listLinks({ limit: 1000 })).rejects.toBeInstanceOf(RequestValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('one link', () => {
  it('reads it by id', async () => {
    const link = linkFixture()
    const fetchMock = stubFetch(jsonResponse(link))

    await expect(getLink('42')).resolves.toEqual(link)
    expect(requestAt(fetchMock)).toMatchObject({ url: '/_/api/v1/links/42', method: 'GET' })
  })

  it('escapes an id rather than letting it rewrite the path', async () => {
    const fetchMock = stubFetch(jsonResponse(linkFixture()))

    await getLink('42/../me')

    expect(requestAt(fetchMock).url).toBe('/_/api/v1/links/42%2F..%2Fme')
  })

  it('creates one, filling in the defaults the shared schema declares', async () => {
    const link = linkFixture()
    const fetchMock = stubFetch(jsonResponse(link, { status: 201 }))

    await expect(
      createLink({ keyword: 'meeting-notes', destination: 'https://docs.acme.com/notes' }),
    ).resolves.toEqual(link)
    expect(requestAt(fetchMock)).toEqual({
      url: '/_/api/v1/links',
      method: 'POST',
      json: {
        keyword: 'meeting-notes',
        destination: 'https://docs.acme.com/notes',
        isUnlisted: false,
      },
    })
  })

  it('changes one', async () => {
    const link = linkFixture({ destination: 'https://wiki.acme.com/notes' })
    const fetchMock = stubFetch(jsonResponse(link))

    await expect(patchLink('42', { destination: 'https://wiki.acme.com/notes' })).resolves.toEqual(
      link,
    )
    expect(requestAt(fetchMock)).toEqual({
      url: '/_/api/v1/links/42',
      method: 'PATCH',
      json: { destination: 'https://wiki.acme.com/notes' },
    })
  })

  it('refuses a change that changes nothing', async () => {
    const fetchMock = stubFetch(jsonResponse(linkFixture()))

    await expect(patchLink('42', {})).rejects.toBeInstanceOf(RequestValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deletes one, expecting no body back', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }))

    await expect(deleteLink('42')).resolves.toBeUndefined()
    expect(requestAt(fetchMock)).toMatchObject({ url: '/_/api/v1/links/42', method: 'DELETE' })
  })
})

describe('suggestLinks', () => {
  it('ranks against a keyword in a namespace (spec 03 §10.2)', async () => {
    const suggestions = { items: [linkFixture()] }
    const fetchMock = stubFetch(jsonResponse(suggestions))

    await expect(
      suggestLinks({ keyword: 'meeting-notes', namespace: 'eng', limit: 3 }),
    ).resolves.toEqual(suggestions)
    expect(requestAt(fetchMock).url).toBe(
      '/_/api/v1/links/suggestions?keyword=meeting-notes&limit=3&namespace=eng',
    )
  })

  it('refuses a limit beyond what suggestions allow', async () => {
    const fetchMock = stubFetch(jsonResponse({ items: [] }))

    await expect(suggestLinks({ keyword: 'notes', limit: 50 })).rejects.toBeInstanceOf(
      RequestValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('createTransfer', () => {
  it('offers a link to someone else (spec 03 §9.2)', async () => {
    const transfer = transferFixture()
    const fetchMock = stubFetch(jsonResponse(transfer, { status: 201 }))

    await expect(createTransfer('42')).resolves.toEqual(transfer)
    expect(requestAt(fetchMock)).toMatchObject({
      url: '/_/api/v1/links/42/transfers',
      method: 'POST',
    })
  })

  it('rejects an offer that is missing its acceptance URL', async () => {
    stubFetch(jsonResponse({ id: '3', expiresAt: '2026-09-08T14:03:00Z' }, { status: 201 }))

    await expect(createTransfer('42')).rejects.toBeInstanceOf(ResponseValidationError)
  })
})

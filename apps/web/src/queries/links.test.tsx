import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import { linkFixture, transferFixture } from '../test/fixtures.ts'
import { createQueryHarness, watchInvalidations } from '../test/render.tsx'
import { queryKeys } from './keys.ts'
import {
  useCreateLink,
  useCreateTransfer,
  useDeleteLink,
  useLink,
  useLinkSuggestions,
  useLinks,
  usePatchLink,
} from './links.ts'

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useLinks', () => {
  it('pages through the directory by following the cursor', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ items: [linkFixture()], nextCursor: 'page-2' }),
      jsonResponse({ items: [linkFixture({ id: '43' })], nextCursor: null }),
    )
    const { queryClient, wrapper } = createQueryHarness()

    const { result } = renderHook(() => useLinks({ sort: 'keyword' }), { wrapper })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))

    expect(requestAt(fetchMock, 0).url).toBe('/_/api/v1/links?sort=keyword')
    expect(result.current.hasNextPage).toBe(true)
    expect(queryClient.getQueryData(queryKeys.links.list({ sort: 'keyword' }))).toBeDefined()

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))

    expect(requestAt(fetchMock, 1).url).toBe('/_/api/v1/links?cursor=page-2&sort=keyword')
    expect(result.current.data?.pages.at(-1)?.items).toEqual([linkFixture({ id: '43' })])
    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('useLink', () => {
  it('caches one link by id', async () => {
    stubFetch(jsonResponse(linkFixture()))
    const { queryClient, wrapper } = createQueryHarness()

    const { result } = renderHook(() => useLink('42'), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(queryClient.getQueryData(queryKeys.links.detail('42'))).toEqual(linkFixture())
  })
})

describe('useLinkSuggestions', () => {
  it('asks nothing until there is a keyword to rank against', async () => {
    const fetchMock = stubFetch(jsonResponse({ items: [] }))
    const { wrapper } = createQueryHarness()

    const { result } = renderHook(() => useLinkSuggestions({ keyword: '  ' }), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ranks against the keyword a member is typing', async () => {
    const fetchMock = stubFetch(jsonResponse({ items: [linkFixture()] }))
    const { wrapper } = createQueryHarness()

    const { result } = renderHook(() => useLinkSuggestions({ keyword: 'meeting' }), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(requestAt(fetchMock).url).toBe('/_/api/v1/links/suggestions?keyword=meeting')
  })
})

describe('changing links', () => {
  it('makes every listing and suggestion stale after a create, and caches the new link', async () => {
    const link = linkFixture({ id: '99' })
    stubFetch(jsonResponse(link, { status: 201 }))
    const { queryClient, wrapper } = createQueryHarness()
    const invalidated = watchInvalidations(queryClient)

    const { result } = renderHook(() => useCreateLink(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        keyword: 'meeting-notes',
        destination: 'https://docs.acme.com/notes',
      })
    })

    expect(queryClient.getQueryData(queryKeys.links.detail('99'))).toEqual(link)
    expect(invalidated()).toEqual([queryKeys.links.lists(), queryKeys.links.suggestions()])
  })

  it('replaces the cached link after a change', async () => {
    const link = linkFixture({ destination: 'https://wiki.acme.com/notes' })
    stubFetch(jsonResponse(link))
    const { queryClient, wrapper } = createQueryHarness()
    queryClient.setQueryData(queryKeys.links.detail('42'), linkFixture())
    const invalidated = watchInvalidations(queryClient)

    const { result } = renderHook(() => usePatchLink(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({
        id: '42',
        body: { destination: 'https://wiki.acme.com/notes' },
      })
    })

    expect(queryClient.getQueryData(queryKeys.links.detail('42'))).toEqual(link)
    expect(invalidated()).toEqual([queryKeys.links.lists(), queryKeys.links.suggestions()])
  })

  it('forgets a deleted link rather than leaving it in the cache', async () => {
    stubFetch(new Response(null, { status: 204 }))
    const { queryClient, wrapper } = createQueryHarness()
    queryClient.setQueryData(queryKeys.links.detail('42'), linkFixture())
    const invalidated = watchInvalidations(queryClient)

    const { result } = renderHook(() => useDeleteLink(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync('42')
    })

    expect(queryClient.getQueryData(queryKeys.links.detail('42'))).toBeUndefined()
    expect(invalidated()).toEqual([queryKeys.links.lists(), queryKeys.links.suggestions()])
  })
})

describe('useCreateTransfer', () => {
  it('returns the acceptance URL and leaves the cache alone, since nothing has changed yet', async () => {
    const transfer = transferFixture()
    const fetchMock = stubFetch(jsonResponse(transfer, { status: 201 }))
    const { queryClient, wrapper } = createQueryHarness()
    const invalidated = watchInvalidations(queryClient)

    const { result } = renderHook(() => useCreateTransfer(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync('42')).resolves.toEqual(transfer)
    })

    expect(requestAt(fetchMock).url).toBe('/_/api/v1/links/42/transfers')
    expect(invalidated()).toEqual([])
  })
})

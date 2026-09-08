import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorResponse, jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import {
  adminUserFixture,
  auditEventFixture,
  brandingFixture,
  linkFixture,
  settingsFixture,
} from '../test/fixtures.ts'
import { createQueryHarness, watchInvalidations } from '../test/render.tsx'
import {
  useAdminEvents,
  useAdminSettings,
  useAdminUser,
  useAdminUserLinks,
  useAdminUsers,
  usePatchAdminUser,
  usePutAdminSettings,
  useReassignLinks,
} from './admin.ts'
import { queryKeys } from './keys.ts'

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useAdminUsers', () => {
  it('pages through the members by following the cursor', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ items: [adminUserFixture()], nextCursor: 'page-2' }),
      jsonResponse({ items: [adminUserFixture({ id: '9' })], nextCursor: null }),
    )
    const { wrapper } = createQueryHarness()

    const { result } = renderHook(() => useAdminUsers({ role: 'member' }), { wrapper })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))

    expect(requestAt(fetchMock, 0).url).toBe('/_/api/v1/admin/users?role=member')

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))

    expect(requestAt(fetchMock, 1).url).toBe('/_/api/v1/admin/users?cursor=page-2&role=member')
    expect(result.current.hasNextPage).toBe(false)
  })
})

describe('useAdminUser', () => {
  it('caches one member by id', async () => {
    stubFetch(jsonResponse(adminUserFixture()))
    const { queryClient, wrapper } = createQueryHarness()

    const { result } = renderHook(() => useAdminUser('7'), { wrapper })

    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(queryClient.getQueryData(queryKeys.admin.users.detail('7'))).toEqual(adminUserFixture())
  })
})

describe('usePatchAdminUser', () => {
  it('replaces the cached member and makes the member listings stale', async () => {
    const user = adminUserFixture({ isEnabled: false })
    stubFetch(jsonResponse(user))
    const { queryClient, wrapper } = createQueryHarness()
    const invalidated = watchInvalidations(queryClient)

    const { result } = renderHook(() => usePatchAdminUser(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: '7', body: { isEnabled: false } })
    })

    expect(queryClient.getQueryData(queryKeys.admin.users.detail('7'))).toEqual(user)
    expect(invalidated()).toEqual([queryKeys.admin.users.lists()])
  })
})

describe('the settings document', () => {
  it('is read into the cache', async () => {
    const settings = settingsFixture()
    const fetchMock = stubFetch(jsonResponse(settings))
    const { queryClient, wrapper } = createQueryHarness()

    const { result } = renderHook(() => useAdminSettings(), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(settings))
    expect(requestAt(fetchMock).url).toBe('/_/api/v1/admin/settings')
    expect(queryClient.getQueryData(queryKeys.admin.settings())).toEqual(settings)
  })

  it('makes the session stale when it is replaced, so branding follows a color change', async () => {
    const settings = settingsFixture({
      branding: brandingFixture({ primaryColor: '#1f4b99' }),
    })
    stubFetch(jsonResponse(settings))
    const { queryClient, wrapper } = createQueryHarness()
    const invalidated = watchInvalidations(queryClient)

    const { result } = renderHook(() => usePutAdminSettings(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(settings)
    })

    expect(queryClient.getQueryData(queryKeys.admin.settings())).toEqual(settings)
    // Branding is read from `/me`, and a changed namespace or keyword rule
    // rewrites what links resolve under (spec 06 §2, §3).
    expect(invalidated()).toEqual([queryKeys.me(), queryKeys.links.all()])
  })
})

describe('useAdminEvents', () => {
  it('pages through the audit trail with its filters', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ items: [auditEventFixture()], nextCursor: 'page-2' }),
      jsonResponse({ items: [auditEventFixture({ id: '902' })], nextCursor: null }),
    )
    const { wrapper } = createQueryHarness()

    const { result } = renderHook(() => useAdminEvents({ type: 'link.created' }), { wrapper })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(1))

    expect(requestAt(fetchMock, 0).url).toBe('/_/api/v1/admin/events?type=link.created')

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))

    expect(requestAt(fetchMock, 1).url).toBe(
      '/_/api/v1/admin/events?cursor=page-2&type=link.created',
    )
  })
})

describe('useAdminUserLinks', () => {
  it('reads every page of what a member owns before answering', async () => {
    const fetchMock = stubFetch(
      jsonResponse({ items: [linkFixture({ id: '41' })], nextCursor: 'page-2' }),
      jsonResponse({ items: [linkFixture({ id: '42' })], nextCursor: null }),
    )
    const { wrapper } = createQueryHarness()

    const { result } = renderHook(() => useAdminUserLinks('9'), { wrapper })
    await waitFor(() => expect(result.current.data?.items).toHaveLength(2))

    expect(result.current.data?.complete).toBe(true)
    expect(requestAt(fetchMock, 0).url).toBe('/_/api/v1/links?limit=200&owner=9')
    expect(requestAt(fetchMock, 1).url).toBe('/_/api/v1/links?cursor=page-2&limit=200&owner=9')
  })
})

describe('useReassignLinks', () => {
  it('moves one link at a time and makes links and members stale', async () => {
    const fetchMock = stubFetch(
      jsonResponse(linkFixture({ id: '41' })),
      jsonResponse(linkFixture({ id: '42' })),
    )
    const { queryClient, wrapper } = createQueryHarness()
    const invalidations = watchInvalidations(queryClient)
    const progress: number[] = []

    const { result } = renderHook(() => useReassignLinks(), { wrapper })
    const outcome = await act(async () =>
      result.current.mutateAsync({
        links: [linkFixture({ id: '41' }), linkFixture({ id: '42' })],
        ownerId: '8',
        onProgress: (completed) => progress.push(completed),
      }),
    )

    expect(outcome.moved).toHaveLength(2)
    expect(progress).toEqual([1, 2])
    expect(requestAt(fetchMock, 0)).toMatchObject({
      url: '/_/api/v1/links/41',
      method: 'PATCH',
      json: { ownerId: '8' },
    })
    expect(requestAt(fetchMock, 1).url).toBe('/_/api/v1/links/42')
    expect(invalidations()).toEqual([queryKeys.links.all(), queryKeys.admin.users.all()])
  })

  it('collects the links the API refused rather than stopping at the first', async () => {
    stubFetch(errorResponse(403, 'forbidden'), jsonResponse(linkFixture({ id: '42' })))
    const { wrapper } = createQueryHarness()

    const { result } = renderHook(() => useReassignLinks(), { wrapper })
    const outcome = await act(async () =>
      result.current.mutateAsync({
        links: [linkFixture({ id: '41' }), linkFixture({ id: '42' })],
        ownerId: '8',
      }),
    )

    expect(outcome.moved.map((link) => link.id)).toEqual(['42'])
    expect(outcome.failures).toHaveLength(1)
    expect(outcome.failures[0]?.link.id).toBe('41')
    expect(outcome.failures[0]?.message).toBe('forbidden happened.')
  })
})

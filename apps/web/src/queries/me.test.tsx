import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorResponse, jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import { meFixture } from '../test/fixtures.ts'
import { createQueryHarness } from '../test/render.tsx'
import { queryKeys } from './keys.ts'
import { useMe, usePatchMe } from './me.ts'

let navigate: ReturnType<typeof stubNavigation>

beforeEach(() => {
  navigate = stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useMe', () => {
  it('caches the session under the key everything else reads it from', async () => {
    const me = meFixture()
    stubFetch(jsonResponse(me))
    const { queryClient, wrapper } = createQueryHarness()

    const { result } = renderHook(() => useMe(), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(me))
    expect(queryClient.getQueryData(queryKeys.me())).toEqual(me)
  })

  it('settles as a failure and sends the browser to sign-in when there is no session', async () => {
    stubFetch(errorResponse(401, 'unauthenticated'))
    const { wrapper } = createQueryHarness()

    const { result } = renderHook(() => useMe(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('waits until the caller says the request is wanted', async () => {
    const fetchMock = stubFetch(jsonResponse(meFixture()))
    const { wrapper } = createQueryHarness()

    const { result } = renderHook(() => useMe({ enabled: false }), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('usePatchMe', () => {
  it('replaces the cached session with what the API answers', async () => {
    const updated = meFixture({ user: { preferences: { dismissedNotices: ['short-host'] } } })
    const fetchMock = stubFetch(jsonResponse(updated))
    const { queryClient, wrapper } = createQueryHarness()
    queryClient.setQueryData(queryKeys.me(), meFixture())

    const { result } = renderHook(() => usePatchMe(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ preferences: { dismissedNotices: ['short-host'] } })
    })

    expect(requestAt(fetchMock)).toMatchObject({ url: '/_/api/v1/me', method: 'PATCH' })
    expect(queryClient.getQueryData(queryKeys.me())).toEqual(updated)
  })
})

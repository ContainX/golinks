import { renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import { linkFixture, transferPreviewFixture } from '../test/fixtures.ts'
import { createQueryHarness, watchInvalidations } from '../test/render.tsx'
import { queryKeys } from './keys.ts'
import { useAcceptTransfer, useTransferPreview } from './transfers.ts'

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('useTransferPreview', () => {
  it('keys the offer by its token', async () => {
    const preview = transferPreviewFixture()
    const fetchMock = stubFetch(jsonResponse(preview))
    const { queryClient, wrapper } = createQueryHarness()

    const { result } = renderHook(() => useTransferPreview('tok-123'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual(preview))
    expect(requestAt(fetchMock).url).toBe('/_/api/v1/transfers/tok-123')
    expect(queryClient.getQueryData(queryKeys.transfers.preview('tok-123'))).toEqual(preview)
  })
})

describe('useAcceptTransfer', () => {
  it('rereads the offer and the listings once the link has changed hands', async () => {
    const link = linkFixture({ owner: { id: '9', email: 'sam@acme.com' } })
    const fetchMock = stubFetch(jsonResponse(link))
    const { queryClient, wrapper } = createQueryHarness()
    const invalidated = watchInvalidations(queryClient)

    const { result } = renderHook(() => useAcceptTransfer(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync('tok-123')).resolves.toEqual(link)
    })

    expect(requestAt(fetchMock)).toMatchObject({
      url: '/_/api/v1/transfers/tok-123/accept',
      method: 'POST',
    })
    expect(queryClient.getQueryData(queryKeys.links.detail('42'))).toEqual(link)
    expect(invalidated()).toEqual([queryKeys.transfers.preview('tok-123'), queryKeys.links.lists()])
  })
})

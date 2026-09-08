import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import { linkFixture, transferPreviewFixture } from '../test/fixtures.ts'
import { ResponseValidationError } from './resource.ts'
import { acceptTransfer, previewTransfer } from './transfers.ts'

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('previewTransfer', () => {
  it('reads what is on offer before anything changes hands', async () => {
    const preview = transferPreviewFixture()
    const fetchMock = stubFetch(jsonResponse(preview))

    await expect(previewTransfer('tok-123')).resolves.toEqual(preview)
    expect(requestAt(fetchMock)).toMatchObject({
      url: '/_/api/v1/transfers/tok-123',
      method: 'GET',
    })
  })

  it('reports an expired offer as a status rather than a failure', async () => {
    stubFetch(jsonResponse(transferPreviewFixture({ status: 'expired' })))

    await expect(previewTransfer('tok-123')).resolves.toMatchObject({ status: 'expired' })
  })

  it('escapes the token', async () => {
    const fetchMock = stubFetch(jsonResponse(transferPreviewFixture()))

    await previewTransfer('tok/123?x=1')

    expect(requestAt(fetchMock).url).toBe('/_/api/v1/transfers/tok%2F123%3Fx%3D1')
  })

  it('rejects a preview with an unknown status', async () => {
    stubFetch(jsonResponse({ ...transferPreviewFixture(), status: 'maybe' }))

    await expect(previewTransfer('tok-123')).rejects.toBeInstanceOf(ResponseValidationError)
  })
})

describe('acceptTransfer', () => {
  it('takes the link over and returns it with its new owner', async () => {
    const link = linkFixture({ owner: { id: '9', email: 'sam@acme.com' } })
    const fetchMock = stubFetch(jsonResponse(link))

    await expect(acceptTransfer('tok-123')).resolves.toEqual(link)
    expect(requestAt(fetchMock)).toMatchObject({
      url: '/_/api/v1/transfers/tok-123/accept',
      method: 'POST',
    })
  })
})

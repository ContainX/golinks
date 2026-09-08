import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import { meFixture } from '../test/fixtures.ts'
import { getMe, patchMe } from './me.ts'
import { RequestValidationError, ResponseValidationError } from './resource.ts'

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('getMe', () => {
  it('reads the session from GET /me', async () => {
    const me = meFixture()
    const fetchMock = stubFetch(jsonResponse(me))

    await expect(getMe()).resolves.toEqual(me)
    expect(requestAt(fetchMock)).toMatchObject({ url: '/_/api/v1/me', method: 'GET' })
  })

  it('rejects a session document that does not match the contract', async () => {
    stubFetch(jsonResponse({ user: meFixture().user }))

    await expect(getMe()).rejects.toBeInstanceOf(ResponseValidationError)
  })

  it('passes an abort signal to the transport', async () => {
    const controller = new AbortController()
    const fetchMock = stubFetch(jsonResponse(meFixture()))

    await getMe({ signal: controller.signal })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('patchMe', () => {
  it('sends the preferences as a PATCH and returns the session it answers with', async () => {
    const me = meFixture({ user: { preferences: { dismissedNotices: ['short-host'] } } })
    const fetchMock = stubFetch(jsonResponse(me))

    await expect(patchMe({ preferences: { dismissedNotices: ['short-host'] } })).resolves.toEqual(
      me,
    )
    expect(requestAt(fetchMock)).toEqual({
      url: '/_/api/v1/me',
      method: 'PATCH',
      json: { preferences: { dismissedNotices: ['short-host'] } },
    })
  })

  it('refuses a preference key the API does not accept, without asking it', async () => {
    const fetchMock = stubFetch(jsonResponse(meFixture()))

    await expect(
      patchMe({ preferences: { theme: 'dark' } } as unknown as Parameters<typeof patchMe>[0]),
    ).rejects.toBeInstanceOf(RequestValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

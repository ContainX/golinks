import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { linkFixture } from '../test/fixtures.ts'
import { API_BASE_PATH, ApiError, apiFetch, browserNavigation, SIGN_IN_PATH } from './http.ts'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

let fetchMock: ReturnType<typeof vi.fn>
let navigate: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  // The test DOM refuses to let `window.location` be replaced or patched, so
  // the redirect is observed through the indirection the module navigates with.
  navigate = vi.spyOn(browserNavigation, 'navigate').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
})

describe('apiFetch', () => {
  it('sends JSON with the session cookie and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: '42' }))

    const result = await apiFetch<{ id: string }>('/links', {
      method: 'POST',
      json: { keyword: 'handbook' },
    })

    expect(result).toEqual({ id: '42' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${API_BASE_PATH}/links`)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.body).toBe(JSON.stringify({ keyword: 'handbook' }))
    const headers = new Headers(init.headers)
    expect(headers.get('Content-Type')).toBe('application/json')
    expect(headers.get('Accept')).toBe('application/json')
  })

  it('returns nothing for a response with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))

    await expect(apiFetch('/links/42', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('maps the error envelope onto an ApiError', async () => {
    const existingLink = linkFixture({ fullPath: 'go/handbook' })
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'keyword_exists',
            message: 'go/handbook already exists.',
            details: { fields: { keyword: 'Already taken.' } },
            existingLink,
          },
        },
        { status: 409, headers: { 'X-Request-Id': 'req-7' } },
      ),
    )

    const error = await apiFetch('/links', { method: 'POST', json: {} }).catch(
      (thrown: unknown) => thrown,
    )

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(409)
    expect(apiError.code).toBe('keyword_exists')
    expect(apiError.message).toBe('go/handbook already exists.')
    expect(apiError.details).toEqual({ fields: { keyword: 'Already taken.' } })
    expect(apiError.existingLink).toEqual(existingLink)
    expect(apiError.requestId).toBe('req-7')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('drops an existing link that is not one, keeping the rest of the failure', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'keyword_conflict',
            message: 'go/handbook conflicts with an existing keyword.',
            existingLink: { id: '42', fullPath: 'go/handbook' },
          },
        },
        { status: 409 },
      ),
    )

    const error = (await apiFetch('/links', { method: 'POST', json: {} }).catch(
      (thrown: unknown) => thrown,
    )) as ApiError

    expect(error.code).toBe('keyword_conflict')
    expect(error.message).toBe('go/handbook conflicts with an existing keyword.')
    expect(error.existingLink).toBeNull()
  })

  it('falls back to a status-derived code when the envelope is missing', async () => {
    fetchMock.mockResolvedValue(new Response('<html>gateway</html>', { status: 502 }))

    const error = (await apiFetch('/links').catch((thrown: unknown) => thrown)) as ApiError

    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(502)
    expect(error.code).toBe('unexpected_response')
  })

  it('sends the browser to sign-in on 401, carrying the current location', async () => {
    window.history.replaceState({}, '', '/_/admin/users?page=2')
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'unauthenticated', message: 'Sign in to continue.' } },
        { status: 401 },
      ),
    )

    const error = (await apiFetch('/me').catch((thrown: unknown) => thrown)) as ApiError

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(
      `/_/auth/login?redirectTo=${encodeURIComponent('/_/admin/users?page=2')}`,
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(401)
    expect(error.code).toBe('unauthenticated')
  })

  it('leaves the browser alone on 401 when the caller is probing for a session', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))

    const error = (await apiFetch('/me', { redirectOnUnauthenticated: false }).catch(
      (thrown: unknown) => thrown,
    )) as ApiError

    expect(navigate).not.toHaveBeenCalled()
    expect(error.code).toBe('unauthenticated')
  })

  it('does not bounce a member who is already looking at the sign-in screen', async () => {
    // `/_/auth/login` hands a member with no session back to `/_/login`
    // (spec 02 §2.1), so redirecting from there would go around forever.
    window.history.replaceState({}, '', `${SIGN_IN_PATH}?error=account_disabled`)
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: 'unauthenticated', message: 'Sign in to continue.' } },
        { status: 401 },
      ),
    )

    const error = (await apiFetch('/me').catch((thrown: unknown) => thrown)) as ApiError

    expect(navigate).not.toHaveBeenCalled()
    expect(error.code).toBe('unauthenticated')
  })

  it('rejects a path that is not relative to the API base', async () => {
    await expect(apiFetch('links')).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * Standing in for the API in tests.
 *
 * The resource modules are exercised against a mocked `fetch`: what matters is
 * the request they build and what they make of the response, neither of which
 * needs a server.
 */

import { type MockInstance, vi } from 'vitest'
import { browserNavigation } from '../api/http.ts'

/** A JSON response, 200 unless the caller says otherwise. */
export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

/** The documented error envelope (spec 05 §4) at a given status. */
export function errorResponse(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ error: { code, message: `${code} happened.`, ...extra } }, { status })
}

export type FetchMock = ReturnType<typeof vi.fn>

/** Installs a `fetch` that answers with the given responses, in order. */
export function stubFetch(...responses: Response[]): FetchMock {
  const fetchMock = vi.fn()
  for (const response of responses) {
    fetchMock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** One request the code under test made. */
export interface RecordedRequest {
  url: string
  method: string
  /** The parsed JSON body, or `undefined` when the request carried none. */
  json: unknown
}

export function requestAt(fetchMock: FetchMock, index = 0): RecordedRequest {
  const call = fetchMock.mock.calls[index] as [string, RequestInit] | undefined
  if (!call) {
    throw new Error(`No request was made at index ${index}.`)
  }
  const [url, init] = call
  const body = init.body
  return {
    url,
    method: init.method ?? 'GET',
    json: typeof body === 'string' ? (JSON.parse(body) as unknown) : undefined,
  }
}

/**
 * Silences the sign-in redirect. The test DOM refuses to let
 * `window.location` be replaced, so the app navigates through an indirection
 * that a test can watch instead.
 */
export function stubNavigation(): MockInstance<(url: string) => void> {
  return vi.spyOn(browserNavigation, 'navigate').mockImplementation(() => {})
}

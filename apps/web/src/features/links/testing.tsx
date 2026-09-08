/**
 * What the screens in these two features need in order to be rendered by a test.
 *
 * The resource modules are exercised against a mocked `fetch` (see
 * `src/test/api.ts`), one response at a time. A screen asks several endpoints at
 * once and in an order it is free to change, so the stub here answers by method
 * and path instead, and records what was asked — which is what most of these
 * tests are actually about: the query the filters produced.
 */

import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { createTestQueryClient } from '../../test/render.tsx'

/** One request the screen made, as the assertions want to read it. */
export interface ApiRequest {
  /** Everything after `/_/api/v1`, query string included. */
  path: string
  method: string
  /** The path without its query string. */
  pathname: string
  /** The query string as a lookup. */
  query: URLSearchParams
  json: unknown
}

/** Answers one `"<METHOD> <pathname>"` key. */
export type ApiResponder = (request: ApiRequest) => Response

/**
 * A handler is either a body to answer with or a function that decides. A body
 * covers the common case; the function is for endpoints whose answer changes
 * over the test, such as a listing that has to reflect a creation.
 */
export type ApiHandler = ApiResponder | unknown

export interface ApiStub {
  /** Every request made, in order. */
  requests: ApiRequest[]
  /** The most recent request to an endpoint, or `undefined`. */
  lastRequest: (key: string) => ApiRequest | undefined
  /** How many times an endpoint was called. */
  callCount: (key: string) => number
}

const API_PREFIX = '/_/api/v1'

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The documented error envelope at a given status (spec 05 §4). */
export function apiError(
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ error: { code, message: `${code} happened.`, ...extra } }, status)
}

function keyOf(request: ApiRequest): string {
  return `${request.method} ${request.pathname}`
}

/**
 * Installs a `fetch` that answers by `"<METHOD> <pathname>"`.
 *
 * An endpoint with no handler is answered 404 `not_found`, so a screen that
 * asks for something the test did not set up fails as a missing link rather
 * than as an undefined response.
 */
export function stubApi(handlers: Record<string, ApiHandler>): ApiStub {
  const requests: ApiRequest[] = []

  const fetchMock = vi.fn((input: string, init: RequestInit = {}) => {
    const raw = input.startsWith(API_PREFIX) ? input.slice(API_PREFIX.length) : input
    const [pathname = '', search = ''] = raw.split('?')
    const body = init.body
    const request: ApiRequest = {
      path: raw,
      pathname,
      method: init.method ?? 'GET',
      query: new URLSearchParams(search),
      json: typeof body === 'string' ? (JSON.parse(body) as unknown) : undefined,
    }
    requests.push(request)

    const handler = handlers[keyOf(request)]
    if (handler === undefined) {
      return Promise.resolve(apiError(404, 'not_found'))
    }
    if (typeof handler === 'function') {
      return Promise.resolve((handler as ApiResponder)(request))
    }
    return Promise.resolve(jsonResponse(handler))
  })

  vi.stubGlobal('fetch', fetchMock)

  return {
    requests,
    lastRequest: (key) => requests.filter((request) => keyOf(request) === key).at(-1),
    callCount: (key) => requests.filter((request) => keyOf(request) === key).length,
  }
}

/** A clipboard that records what was copied; jsdom has none of its own. */
export function stubClipboard(): { writeText: ReturnType<typeof vi.fn> } {
  const writeText = vi.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  })
  return { writeText }
}

/**
 * Pins the viewport width so that the responsive layout can be tested.
 * `matches` true is the phone layout (below the `md` breakpoint).
 */
export function stubViewport(narrow: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: narrow ? query.includes('max-width') : query.includes('min-width'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })),
  )
}

export interface RenderRoutesOptions {
  path?: string
  queryClient?: QueryClient
}

/** Renders a route table at one address, over a cache of its own. */
export function renderRoutes(routes: RouteObject[], options: RenderRoutesOptions = {}) {
  const { path = '/', queryClient = createTestQueryClient() } = options
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...result, router, queryClient }
}

/** Renders one element as the only route, for components below a page. */
export function renderScreen(ui: ReactElement, options: RenderRoutesOptions = {}) {
  return renderRoutes([{ path: '*', element: ui }], options)
}

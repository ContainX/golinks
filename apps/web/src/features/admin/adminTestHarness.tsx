/**
 * Rendering an administration screen the way the router does, against a `fetch`
 * that answers by endpoint.
 *
 * The screens here fire several requests at once — the session, a listing, the
 * members behind an actor id — so a queue of responses in call order would be a
 * test asserting on render order. These helpers route by method and path
 * instead, and a request nothing answers is a loud failure rather than a hang.
 *
 * The route table mirrors the admin branch of `app/routes.tsx`: the same paths,
 * so tab navigation is exercised for real, without pulling the rest of the
 * app's screens into a test about administration.
 */

import { API_BASE_PATH } from '@golinks/shared/api'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { vi } from 'vitest'
import { AdminEventsPage } from '../../pages/admin/AdminEventsPage.tsx'
import { AdminOverviewPage } from '../../pages/admin/AdminOverviewPage.tsx'
import { AdminSettingsPage } from '../../pages/admin/AdminSettingsPage.tsx'
import { AdminUsersPage } from '../../pages/admin/AdminUsersPage.tsx'
import { jsonResponse } from '../../test/api.ts'
import { createTestQueryClient } from '../../test/render.tsx'

/** Any origin will do: the app only ever asks for paths. */
const TEST_ORIGIN = 'https://links.example.com'

/** One request as a handler sees it. */
export interface StubRequest {
  url: URL
  method: string
  /** The parsed JSON body, or undefined when the request carried none. */
  body: unknown
}

/** Answers a request, or declines it by returning undefined. */
export type StubHandler = (request: StubRequest) => Response | undefined

/**
 * An answer for one endpoint. `path` is relative to the API base path, and
 * `respond` may return a Response or a value to send as JSON; returning
 * undefined declines, which lets two handlers share a path.
 */
export function route(
  method: string,
  path: string,
  respond: (request: StubRequest) => unknown,
): StubHandler {
  return (request) => {
    if (request.method !== method || request.url.pathname !== `${API_BASE_PATH}${path}`) {
      return undefined
    }
    const answer = respond(request)
    if (answer === undefined) {
      return undefined
    }
    return answer instanceof Response ? answer : jsonResponse(answer)
  }
}

/** The same, for endpoints whose path carries an id. */
export function routeMatching(
  method: string,
  pattern: RegExp,
  respond: (request: StubRequest) => unknown,
): StubHandler {
  return (request) => {
    if (request.method !== method || !pattern.test(request.url.pathname)) {
      return undefined
    }
    const answer = respond(request)
    if (answer === undefined) {
      return undefined
    }
    return answer instanceof Response ? answer : jsonResponse(answer)
  }
}

/** The last path segment of a request, which is how these routes carry an id. */
export function idOf(request: StubRequest): string {
  return decodeURIComponent(request.url.pathname.split('/').at(-1) ?? '')
}

/** Installs a `fetch` that hands each request to the first handler that takes it. */
export function stubApi(...handlers: StubHandler[]) {
  const fetchMock = vi.fn((input: string, init: RequestInit = {}) => {
    const url = new URL(input, TEST_ORIGIN)
    const request: StubRequest = {
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    }
    for (const handler of handlers) {
      const response = handler(request)
      if (response !== undefined) {
        return Promise.resolve(response)
      }
    }
    return Promise.reject(
      new Error(`Nothing stubbed ${request.method} ${url.pathname}${url.search}`),
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The list envelope every collection endpoint answers with (spec 05 §1). */
export function listEnvelope<Item>(items: Item[], nextCursor: string | null = null) {
  return { items, nextCursor }
}

/** The admin branch of the client route table, as `app/routes.tsx` declares it. */
export const adminTestRoutes: RouteObject[] = [
  { path: '/_/admin', element: <AdminOverviewPage /> },
  { path: '/_/admin/users', element: <AdminUsersPage /> },
  { path: '/_/admin/settings', element: <AdminSettingsPage /> },
  { path: '/_/admin/events', element: <AdminEventsPage /> },
]

/** Renders the admin area at a path, with a cache of its own. */
export function renderAdminAt(path: string, queryClient = createTestQueryClient()) {
  const router = createMemoryRouter(adminTestRoutes, { initialEntries: [path] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { ...view, queryClient, router }
}

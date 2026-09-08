import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserNavigation } from '../../api/http.ts'
import { DirectoryPage } from '../../pages/DirectoryPage.tsx'
import { stubNavigation } from '../../test/api.ts'
import { linkFixture, meFixture } from '../../test/fixtures.ts'
import type { ApiHandler } from './testing.tsx'
import { apiError, jsonResponse, renderRoutes, stubApi } from './testing.tsx'

const routes: RouteObject[] = [
  { path: '/', element: <DirectoryPage /> },
  { path: '/_', element: <DirectoryPage /> },
  { path: '/_/links/:id', element: <DirectoryPage /> },
]

const me = meFixture({ user: { id: '7', email: 'sam@acme.com', role: 'member' } })

const hrHandbook = linkFixture({
  id: '5',
  displayKeyword: 'hr-handbook',
  fullPath: 'go/hr-handbook',
  destination: 'https://wiki.acme.com/people/handbook',
})

const engHandbook = linkFixture({
  id: '6',
  namespace: 'eng',
  displayKeyword: 'handbook',
  fullPath: 'eng/handbook',
  destination: 'https://wiki.acme.com/eng/handbook',
})

function missApi(overrides: Record<string, ApiHandler> = {}) {
  return stubApi({
    'GET /me': me,
    'GET /links': { items: [], nextCursor: null },
    'GET /links/suggestions': { items: [hrHandbook, engHandbook] },
    ...overrides,
  })
}

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('where a keyword that does not exist lands', () => {
  it('shows a screen of its own rather than the directory', async () => {
    missApi()
    renderRoutes(routes, { path: '/_/?keyword=handbook' })

    expect(
      await screen.findByRole('heading', { name: "go/handbook doesn't exist yet" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Search links' })).toBeNull()
  })

  it('locks the keyword in as it was typed and asks only for a destination', async () => {
    missApi()
    renderRoutes(routes, { path: '/_/?keyword=handbook' })

    await screen.findByRole('heading', { name: "go/handbook doesn't exist yet" })
    expect(screen.getByText('Keyword as you typed it')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Keyword' })).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Destination' })).toBeInTheDocument()
  })

  it('names the namespace the resolver reported', async () => {
    const api = missApi()
    renderRoutes(routes, { path: '/_/?keyword=deploy&namespace=eng' })

    await screen.findByRole('heading', { name: "eng/deploy doesn't exist yet" })
    await waitFor(() =>
      expect(api.lastRequest('GET /links/suggestions')?.query.get('namespace')).toBe('eng'),
    )
  })

  it('offers similar links, each of which is reached with a full navigation', async () => {
    missApi()
    renderRoutes(routes, { path: '/_/?keyword=handbook' })

    expect(await screen.findByText('Did you mean')).toBeInTheDocument()
    expect(screen.getByText('go/hr-handbook')).toBeInTheDocument()

    const goButtons = screen.getAllByRole('button', { name: 'Go' })
    fireEvent.click(goButtons[0] as HTMLElement)
    expect(browserNavigation.navigate).toHaveBeenCalledWith('/hr-handbook')

    fireEvent.click(goButtons[1] as HTMLElement)
    expect(browserNavigation.navigate).toHaveBeenCalledWith('/eng/handbook')
  })

  it('creates the keyword that was typed and opens the link it made', async () => {
    const created = linkFixture({ id: '77', displayKeyword: 'handbook', fullPath: 'go/handbook' })
    const api = missApi({
      'POST /links': () => jsonResponse(created, 201),
      'GET /links/77': created,
    })
    const { router } = renderRoutes(routes, { path: '/_/?keyword=handbook' })

    await screen.findByRole('heading', { name: "go/handbook doesn't exist yet" })
    fireEvent.change(screen.getByRole('textbox', { name: 'Destination' }), {
      target: { value: 'https://wiki.acme.com/handbook' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create go/handbook' }))

    await waitFor(() => expect(api.callCount('POST /links')).toBe(1))
    expect(api.lastRequest('POST /links')?.json).toEqual({
      keyword: 'handbook',
      destination: 'https://wiki.acme.com/handbook',
      isUnlisted: false,
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/_/links/77'))
  })

  it('goes back to the directory', async () => {
    missApi()
    const { router } = renderRoutes(routes, { path: '/_/?keyword=handbook' })

    await screen.findByRole('heading', { name: "go/handbook doesn't exist yet" })
    fireEvent.click(screen.getByRole('button', { name: 'Back to directory' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('refuses a typed keyword the organization rules do not allow', async () => {
    missApi()
    renderRoutes(routes, { path: '/_/?keyword=Not%20Allowed!' })

    await screen.findByRole('heading', { name: "go/Not Allowed! doesn't exist yet" })
    expect(await screen.findByText(/allows keywords matching/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create go/Not Allowed!' })).toBeDisabled()
  })

  it('shows the link a race created before this one, with a way into it', async () => {
    const existing = linkFixture({ id: '3', fullPath: 'go/handbook' })
    missApi({
      'POST /links': () => apiError(409, 'keyword_exists', { existingLink: existing }),
      'GET /links/3': existing,
    })
    const { router } = renderRoutes(routes, { path: '/_/?keyword=handbook' })

    await screen.findByRole('heading', { name: "go/handbook doesn't exist yet" })
    fireEvent.change(screen.getByRole('textbox', { name: 'Destination' }), {
      target: { value: 'https://wiki.acme.com/handbook' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create go/handbook' }))

    expect(await screen.findByText(/go\/handbook goes to/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/_/links/3'))
  })
})

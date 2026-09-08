import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meFixture, settingsFixture } from '../../test/fixtures.ts'
import { createTestQueryClient } from '../../test/render.tsx'
import { AdminLayout } from './AdminLayout.tsx'
import { listEnvelope, renderAdminAt, route, stubApi } from './adminTestHarness.tsx'

const asAdmin = route('GET', '/me', () => meFixture())
const asMember = route('GET', '/me', () => meFixture({ user: { role: 'member' } }))
const noMembers = route('GET', '/admin/users', () => listEnvelope([]))
const noEvents = route('GET', '/admin/events', () => listEnvelope([]))
const storedSettings = route('GET', '/admin/settings', () => settingsFixture())

/**
 * A viewport below the `md` breakpoint. The test DOM has no `matchMedia` at
 * all, which reads as a wide screen, so narrowness is something a test has to
 * say explicitly.
 */
function stubNarrowScreen(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the admin frame', () => {
  it('turns a member away without asking the admin endpoints anything', async () => {
    const fetchMock = stubApi(asMember)

    renderAdminAt('/_/admin/users')

    expect(await screen.findByText('Admins only')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    for (const [url] of fetchMock.mock.calls) {
      expect(url).not.toContain('/admin/')
    }
  })

  it('shows the three tabs to an admin, with the open one selected', async () => {
    stubApi(asAdmin, noMembers)

    renderAdminAt('/_/admin/users')

    expect(await screen.findByRole('tab', { name: 'Users' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'false')
  })

  it('navigates between the tabs', async () => {
    stubApi(asAdmin, noMembers, storedSettings, noEvents)

    const { router } = renderAdminAt('/_/admin/users')
    await screen.findByRole('table', { name: 'Members' })

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }))
    expect(await screen.findByRole('heading', { name: 'Namespaces' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/_/admin/settings')

    fireEvent.click(screen.getByRole('tab', { name: 'Events' }))
    expect(await screen.findByRole('table', { name: 'Audit events' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/_/admin/events')
  })

  it('opens the area on the members tab', async () => {
    stubApi(asAdmin, noMembers)

    const { router } = renderAdminAt('/_/admin')

    await waitFor(() => expect(router.state.location.pathname).toBe('/_/admin/users'))
    expect(await screen.findByRole('table', { name: 'Members' })).toBeInTheDocument()
  })

  it('says the screens are desktop-only on a narrow viewport', async () => {
    stubNarrowScreen()
    stubApi(asAdmin)

    renderAdminAt('/_/admin/users')

    expect(await screen.findByText('Administration is desktop-only')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Users' })).toBeInTheDocument()
  })

  it('draws one frame however the routes nest it', async () => {
    stubApi(asAdmin)
    const router = createMemoryRouter(
      [
        {
          path: '/_/admin/users',
          element: (
            <AdminLayout>
              <AdminLayout>
                <p>The members table</p>
              </AdminLayout>
            </AdminLayout>
          ),
        },
      ],
      { initialEntries: ['/_/admin/users'] },
    )
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('The members table')).toBeInTheDocument()
    expect(screen.getAllByRole('tablist')).toHaveLength(1)
  })
})

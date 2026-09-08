import { render, screen } from '@testing-library/react'
import { createMemoryRouter, matchRoutes, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorResponse, stubFetch, stubNavigation } from '../test/api.ts'
import { createTestQueryClient } from '../test/render.tsx'
import { AppProviders } from './AppProviders.tsx'
import { appRoutes } from './routes.tsx'

beforeEach(() => {
  // Every screen renders under the providers, which read `/me` for the
  // organization's branding. These tests are about the route table, so the
  // session is answered as absent and the theme falls back to the stock one.
  stubFetch(errorResponse(401, 'unauthenticated'))
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] })
  return render(
    <AppProviders queryClient={createTestQueryClient()}>
      <RouterProvider router={router} />
    </AppProviders>,
  )
}

/** The last match is the leaf route that renders. */
function leafPathAt(path: string): string | undefined {
  const matches = matchRoutes(appRoutes, path)
  return matches?.at(-1)?.route.path
}

describe('the route table', () => {
  it('renders the sign-in placeholder at /_/login', async () => {
    renderAt('/_/login')

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows the raw error code the auth endpoint passed on', async () => {
    renderAt('/_/login?error=account_disabled')

    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.getByText('account_disabled')).toBeInTheDocument()
  })

  it('shows that the member signed out', async () => {
    renderAt('/_/login?signedOut=1')

    await screen.findByRole('heading', { name: 'Sign in' })
    expect(screen.getByText(/Signed out/)).toBeInTheDocument()
  })

  it('renders the directory at / and at the address a resolver miss lands on', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Directory' })).toBeInTheDocument()

    renderAt('/_/?keyword=nothing-here')
    expect(await screen.findAllByRole('heading', { name: 'Directory' })).not.toHaveLength(0)
  })

  it('matches the application routes under /_/', () => {
    expect(leafPathAt('/_/login')).toBe('login')
    expect(leafPathAt('/_/transfer/abc123')).toBe('transfer/:token')
    expect(leafPathAt('/_/admin/users')).toBe('users')
    expect(leafPathAt('/_/admin/settings')).toBe('settings')
    expect(leafPathAt('/_/admin/events')).toBe('events')
  })

  it('answers an unknown path under /_/ with the not-found route', () => {
    expect(leafPathAt('/_/nowhere')).toBe('*')
    expect(leafPathAt('/_/admin/nowhere')).toBe('*')
  })

  it('never claims a keyword path, which belongs to the resolver', () => {
    // Spec 04 §1: everything that is not `/` or `/_/**` is a potential keyword
    // and is answered by the server, so the client router must not match it.
    for (const keywordPath of ['/handbook', '/eng/deploy', '/jira/ACME-123', '/_leading']) {
      expect(matchRoutes(appRoutes, keywordPath)).toBeNull()
    }
  })
})

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryPage } from '../../pages/DirectoryPage.tsx'
import { stubNavigation } from '../../test/api.ts'
import { linkFixture, meFixture } from '../../test/fixtures.ts'
import type { ApiHandler } from './testing.tsx'
import { apiError, jsonResponse, renderRoutes, stubApi } from './testing.tsx'

const routes: RouteObject[] = [
  { path: '/', element: <DirectoryPage /> },
  { path: '/_/links/:id', element: <DirectoryPage /> },
]

const me = meFixture({ user: { id: '7', email: 'sam@acme.com', role: 'member' } })

const handbook = linkFixture({
  id: '1',
  displayKeyword: 'handbook',
  fullPath: 'go/handbook',
  owner: { id: '7', email: 'sam@acme.com' },
})

function createApi(overrides: Record<string, ApiHandler> = {}) {
  return stubApi({
    'GET /me': me,
    'GET /links': { items: [handbook], nextCursor: null },
    ...overrides,
  })
}

function typeInto(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
}

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the create bar', () => {
  it('offers a namespace when the organization has more than one', async () => {
    createApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    expect(screen.getByLabelText('Namespace')).toBeInTheDocument()
  })

  it('shows the default namespace as a prefix when it is the only one', async () => {
    stubApi({
      'GET /me': meFixture({
        user: { id: '7', role: 'member' },
        organization: { namespaces: [] },
      }),
      'GET /links': { items: [handbook], nextCursor: null },
    })
    renderRoutes(routes)

    await screen.findByText('handbook')
    expect(screen.queryByLabelText('Namespace')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Keyword' }).parentElement).toHaveTextContent('go/')
  })

  it('enforces the keyword rules as the member types', async () => {
    createApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    typeInto('Keyword', 'Meeting Notes!')

    expect(await screen.findByText(/allows keywords matching/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('refuses the prefix the application reserves before a request is made', async () => {
    const api = createApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    typeInto('Keyword', '_admin')
    typeInto('Destination', 'https://wiki.acme.com')

    expect(await screen.findByText(/must not start with "_"/)).toBeInTheDocument()
    expect(api.callCount('POST /links')).toBe(0)
  })

  it('explains %s and previews where a sample value would land', async () => {
    createApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    typeInto('Keyword', 'jira/%s')
    typeInto('Destination', 'https://acme.atlassian.net/browse/%s')

    expect(await screen.findByText(/takes whatever is typed in its place/)).toBeInTheDocument()
    expect(
      screen.getByText('go/jira/example goes to https://acme.atlassian.net/browse/example'),
    ).toBeInTheDocument()
  })

  it('reports a destination that has the wrong number of placeholders', async () => {
    createApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    typeInto('Keyword', 'jira/%s')
    typeInto('Destination', 'https://acme.atlassian.net/browse')

    expect(await screen.findByText(/but the destination has 0/)).toBeInTheDocument()
  })

  it('creates the link, shows it at the top of the table, and confirms', async () => {
    const created = linkFixture({
      id: '9',
      displayKeyword: 'onboarding',
      fullPath: 'go/onboarding',
      destination: 'https://wiki.acme.com/onboarding',
      visitCount: 0,
      owner: { id: '7', email: 'sam@acme.com' },
    })
    const api = createApi({ 'POST /links': () => jsonResponse(created, 201) })
    renderRoutes(routes)

    await screen.findByText('handbook')
    typeInto('Keyword', 'onboarding')
    typeInto('Destination', 'wiki.acme.com/onboarding')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Created go/onboarding')).toBeInTheDocument()
    expect(api.lastRequest('POST /links')?.json).toEqual({
      keyword: 'onboarding',
      destination: 'wiki.acme.com/onboarding',
      isUnlisted: false,
    })

    const rows = screen.getAllByRole('row')
    expect(within(rows[1] as HTMLElement).getByText('onboarding')).toBeInTheDocument()
  })

  it('names the namespace only when it is not the default one', async () => {
    const api = createApi({ 'POST /links': () => jsonResponse(linkFixture({ id: '9' }), 201) })
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.mouseDown(screen.getByLabelText('Namespace'))
    fireEvent.click(await screen.findByRole('option', { name: 'eng' }))
    typeInto('Keyword', 'deploy')
    typeInto('Destination', 'https://deploy.acme.com')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(api.callCount('POST /links')).toBe(1))
    expect(api.lastRequest('POST /links')?.json).toEqual({
      namespace: 'eng',
      keyword: 'deploy',
      destination: 'https://deploy.acme.com',
      isUnlisted: false,
    })
  })

  it('shows the link a keyword collided with, and opens it', async () => {
    const api = createApi({
      'POST /links': () => apiError(409, 'keyword_exists', { existingLink: handbook }),
      'GET /links/1': handbook,
    })
    const { router } = renderRoutes(routes)

    await screen.findByText('handbook')
    typeInto('Keyword', 'handbook')
    typeInto('Destination', 'https://wiki.acme.com')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('keyword_exists happened.')).toBeInTheDocument()
    expect(screen.getByText('go/handbook goes to https://docs.acme.com/notes')).toBeInTheDocument()
    expect(api.callCount('POST /links')).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/_/links/1'))
  })
})

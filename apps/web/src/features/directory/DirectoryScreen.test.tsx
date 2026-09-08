import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserNavigation } from '../../api/http.ts'
import { DirectoryPage } from '../../pages/DirectoryPage.tsx'
import { stubNavigation } from '../../test/api.ts'
import { linkFixture, meFixture } from '../../test/fixtures.ts'
import type { ApiHandler, ApiRequest } from '../links/testing.tsx'
import { renderRoutes, stubApi, stubClipboard, stubViewport } from '../links/testing.tsx'

const routes: RouteObject[] = [
  { path: '/', element: <DirectoryPage /> },
  { path: '/_', element: <DirectoryPage /> },
  { path: '/_/links/:id', element: <DirectoryPage /> },
]

const me = meFixture({ user: { id: '7', email: 'sam@acme.com', role: 'member' } })

const handbook = linkFixture({
  id: '1',
  keyword: 'handbook',
  displayKeyword: 'handbook',
  fullPath: 'go/handbook',
  destination: 'https://wiki.acme.com/handbook',
  owner: { id: '9', email: 'jane@acme.com' },
  visitCount: 4812,
  permissions: {
    canEditDestination: false,
    canEdit: false,
    canDelete: false,
    canTransfer: false,
  },
})

const jira = linkFixture({
  id: '2',
  keyword: 'jira/%s',
  displayKeyword: 'jira/%s',
  fullPath: 'go/jira/%s',
  destination: 'https://acme.atlassian.net/browse/%s',
  isProgrammatic: true,
  placeholderCount: 1,
  owner: { id: '7', email: 'sam@acme.com' },
  visitCount: 3190,
})

const deploy = linkFixture({
  id: '3',
  namespace: 'eng',
  keyword: 'deploy',
  displayKeyword: 'deploy',
  fullPath: 'eng/deploy',
  destination: 'https://deploy.acme.com',
  owner: { id: '7', email: 'sam@acme.com' },
  visitCount: 655,
})

function directoryApi(overrides: Record<string, ApiHandler> = {}) {
  return stubApi({
    'GET /me': me,
    'GET /links': { items: [handbook, jira, deploy], nextCursor: null },
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

describe('the directory table', () => {
  it('shows one row per link, with the member own links marked as theirs', async () => {
    directoryApi()
    renderRoutes(routes)

    expect(await screen.findByText('handbook')).toBeInTheDocument()
    expect(screen.getByText('https://wiki.acme.com/handbook')).toBeInTheDocument()
    expect(screen.getByText('jane@acme.com')).toBeInTheDocument()
    expect(screen.getAllByText('you')).toHaveLength(2)
    expect(screen.getByText('4,812')).toBeInTheDocument()
  })

  it('marks a programmatic keyword and shows the namespace of every link', async () => {
    directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    expect(screen.getByText('%s')).toBeInTheDocument()
    expect(screen.getByText('eng/')).toBeInTheDocument()
  })

  it('disables edit and the row menu, with the rule, on a link the member cannot change', async () => {
    directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')

    expect(screen.getByRole('button', { name: 'Edit go/handbook' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'More actions for go/handbook' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit go/jira/%s' })).toBeEnabled()

    const disabledEdit = screen.getByRole('button', { name: 'Edit go/handbook' })
    fireEvent.mouseOver(disabledEdit.parentElement ?? disabledEdit)
    expect(
      await screen.findByText('Only the owner or an admin can change this link'),
    ).toBeInTheDocument()
  })

  it('copies the short form, which includes a non-default namespace', async () => {
    const clipboard = stubClipboard()
    directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.click(screen.getByRole('button', { name: 'Copy go/handbook' }))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('go/handbook'))

    fireEvent.click(screen.getByRole('button', { name: 'Copy go/eng/deploy' }))
    await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith('go/eng/deploy'))
  })

  it('opens a link drawer at its own address when a row is clicked', async () => {
    directoryApi({ 'GET /links/1': handbook })
    const { router } = renderRoutes(routes)

    fireEvent.click(await screen.findByText('handbook'))

    await waitFor(() => expect(router.state.location.pathname).toBe('/_/links/1'))
  })
})

describe('filters, search, and sort', () => {
  it('starts on the default sort and no filter', async () => {
    const api = directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    const request = api.lastRequest('GET /links')
    expect(request?.query.get('sort')).toBe('visits')
    expect(request?.query.get('order')).toBe('desc')
    expect(request?.query.get('owner')).toBeNull()
  })

  it('asks the API for the member own links when Mine is chosen', async () => {
    const api = directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }))

    await waitFor(() => expect(api.lastRequest('GET /links')?.query.get('owner')).toBe('me'))
  })

  it('offers a chip per namespace and filters by it', async () => {
    const api = directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.click(screen.getByRole('button', { name: 'eng' }))

    await waitFor(() => expect(api.lastRequest('GET /links')?.query.get('namespace')).toBe('eng'))
  })

  it('filters to programmatic links through the API', async () => {
    const api = directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.click(screen.getByRole('button', { name: 'Programmatic' }))

    await waitFor(() =>
      expect(api.lastRequest('GET /links')?.query.get('programmatic')).toBe('true'),
    )
  })

  it('offers the unlisted chip only when the member has unlisted links to see', async () => {
    directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    expect(screen.queryByRole('button', { name: 'Unlisted' })).toBeNull()
  })

  it('narrows to unlisted links without a listing parameter the API has no name for', async () => {
    const unlisted = linkFixture({
      id: '4',
      displayKeyword: 'payroll',
      fullPath: 'go/payroll',
      isUnlisted: true,
      owner: { id: '7', email: 'sam@acme.com' },
    })
    const api = stubApi({
      'GET /me': me,
      'GET /links': { items: [handbook, unlisted], nextCursor: null },
    })
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.click(screen.getByRole('button', { name: 'Unlisted' }))

    await waitFor(() => expect(screen.queryByText('handbook')).toBeNull())
    expect(screen.getByText('payroll')).toBeInTheDocument()
    expect(api.lastRequest('GET /links')?.query.get('namespace')).toBeNull()
  })

  it('sends the typed search as q once typing pauses', async () => {
    const api = directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search links' }), {
      target: { value: 'wiki' },
    })

    await waitFor(() => expect(api.lastRequest('GET /links')?.query.get('q')).toBe('wiki'))
  })

  it('changes the sort the API is asked for', async () => {
    const api = directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.click(screen.getByRole('button', { name: 'Sort: Most visited' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Keyword' }))

    await waitFor(() => {
      const request = api.lastRequest('GET /links')
      expect(request?.query.get('sort')).toBe('keyword')
      expect(request?.query.get('order')).toBe('asc')
    })
  })

  it('follows the cursor when another page is asked for', async () => {
    let page = 0
    const api = stubApi({
      'GET /me': me,
      'GET /links': () => {
        page += 1
        return page === 1
          ? new Response(JSON.stringify({ items: [handbook], nextCursor: 'page-2' }), {
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response(JSON.stringify({ items: [deploy], nextCursor: null }), {
              headers: { 'Content-Type': 'application/json' },
            })
      },
    })
    renderRoutes(routes)

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))

    expect(await screen.findByText('deploy')).toBeInTheDocument()
    expect(api.lastRequest('GET /links')?.query.get('cursor')).toBe('page-2')
  })
})

describe('Enter to go', () => {
  it('goes to the keyword with a full navigation on an exact match', async () => {
    directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    const search = screen.getByRole('textbox', { name: 'Search links' })
    fireEvent.change(search, { target: { value: 'handbook' } })

    expect(await screen.findByText('Go')).toBeInTheDocument()
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(browserNavigation.navigate).toHaveBeenCalledWith('/handbook')
  })

  it('keeps the non-default namespace in the path it goes to', async () => {
    directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    const search = screen.getByRole('textbox', { name: 'Search links' })
    fireEvent.change(search, { target: { value: 'eng/deploy' } })

    await screen.findByText('Go')
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(browserNavigation.navigate).toHaveBeenCalledWith('/eng/deploy')
  })

  it('does nothing on Enter when the search is not a keyword', async () => {
    directoryApi()
    renderRoutes(routes)

    await screen.findByText('handbook')
    const search = screen.getByRole('textbox', { name: 'Search links' })
    fireEvent.change(search, { target: { value: 'hand' } })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(screen.queryByText('Go')).toBeNull()
    expect(browserNavigation.navigate).not.toHaveBeenCalled()
  })
})

describe('an organization with no links', () => {
  it('explains what a link is and how to reach the short host, in place of the table', async () => {
    stubApi({ 'GET /me': me, 'GET /links': { items: [], nextCursor: null } })
    renderRoutes(routes)

    expect(await screen.findByText('No links yet')).toBeInTheDocument()
    expect(screen.getByText(/go\/handbook/)).toBeInTheDocument()
    expect(screen.getByText(/https:\/\/links.example.com/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('says a search matched nothing rather than that the organization is empty', async () => {
    stubApi({
      'GET /me': me,
      'GET /links': (request: ApiRequest) =>
        new Response(
          JSON.stringify({ items: request.query.get('q') ? [] : [handbook], nextCursor: null }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    })
    renderRoutes(routes)

    await screen.findByText('handbook')
    fireEvent.change(screen.getByRole('textbox', { name: 'Search links' }), {
      target: { value: 'nothing' },
    })

    expect(await screen.findByText('No links match')).toBeInTheDocument()
    expect(screen.queryByText('No links yet')).toBeNull()
  })
})

describe('on a narrow screen', () => {
  it('lists links on two lines with copy, and offers create from a button', async () => {
    stubViewport(true)
    stubClipboard()
    directoryApi()
    renderRoutes(routes)

    const list = await screen.findByRole('list', { name: 'Links' })
    expect(within(list).getByText('handbook')).toBeInTheDocument()
    expect(within(list).getByText('https://wiki.acme.com/handbook')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Create a link' }))
    expect(await screen.findByRole('dialog', { name: 'Create a link' })).toBeInTheDocument()
  })
})

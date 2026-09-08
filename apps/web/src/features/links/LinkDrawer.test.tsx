import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryPage } from '../../pages/DirectoryPage.tsx'
import { stubNavigation } from '../../test/api.ts'
import { adminUserFixture, linkFixture, meFixture } from '../../test/fixtures.ts'
import type { ApiHandler } from './testing.tsx'
import { apiError, jsonResponse, renderRoutes, stubApi, stubClipboard } from './testing.tsx'

const routes: RouteObject[] = [
  { path: '/', element: <DirectoryPage /> },
  { path: '/_/links/:id', element: <DirectoryPage /> },
]

const member = meFixture({ user: { id: '7', email: 'sam@acme.com', role: 'member' } })
const admin = meFixture({ user: { id: '7', email: 'sam@acme.com', role: 'admin' } })

/** Owned by the signed-in member, with everything permitted. */
const ownLink = linkFixture({
  id: '1',
  displayKeyword: 'handbook',
  fullPath: 'go/handbook',
  destination: 'https://wiki.acme.com/handbook',
  owner: { id: '7', email: 'sam@acme.com' },
  visitCount: 42,
})

/** Owned by someone else, with nothing permitted. */
const othersLink = linkFixture({
  id: '1',
  displayKeyword: 'handbook',
  fullPath: 'go/handbook',
  destination: 'https://wiki.acme.com/handbook',
  owner: { id: '9', email: 'jane@acme.com' },
  visitCount: 42,
  permissions: { canEditDestination: false, canEdit: false, canDelete: false, canTransfer: false },
})

function drawerApi(link: ApiHandler, me: unknown, overrides: Record<string, ApiHandler> = {}) {
  return stubApi({
    'GET /me': me,
    'GET /links': { items: [], nextCursor: null },
    'GET /links/1': link,
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

describe('the drawer an owner sees', () => {
  it('lets every field be changed and offers transfer and delete', async () => {
    drawerApi(ownLink, member)
    renderRoutes(routes, { path: '/_/links/1' })

    expect(await screen.findByRole('heading', { name: 'go/handbook' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Keyword' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Destination' })).toBeEnabled()
    expect(screen.getByLabelText('Unlisted')).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete link' })).toBeInTheDocument()
    expect(screen.getByText('sam@acme.com (you)')).toBeInTheDocument()
  })

  it('shows how much the link is used', async () => {
    drawerApi(ownLink, member)
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    expect(screen.getByText('Visits')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Last used')).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
  })

  it('sends only the fields that changed', async () => {
    const api = drawerApi(ownLink, member, {
      'PATCH /links/1': () =>
        jsonResponse({ ...ownLink, destination: 'https://wiki.acme.com/new' }),
    })
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()

    fireEvent.change(screen.getByRole('textbox', { name: 'Destination' }), {
      target: { value: 'https://wiki.acme.com/new' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(api.callCount('PATCH /links/1')).toBe(1))
    expect(api.lastRequest('PATCH /links/1')?.json).toEqual({
      destination: 'https://wiki.acme.com/new',
    })
    expect(await screen.findByText('Saved go/handbook')).toBeInTheDocument()
  })

  it('puts a refusal under the field it belongs to', async () => {
    drawerApi(ownLink, member, {
      'PATCH /links/1': () => apiError(400, 'destination_invalid'),
    })
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Destination' }), {
      target: { value: 'https://wiki.acme.com/other' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('destination_invalid happened.')).toBeInTheDocument()
  })

  it('shows the link a renamed keyword collided with', async () => {
    const other = linkFixture({ id: '5', fullPath: 'go/taken' })
    drawerApi(ownLink, member, {
      'PATCH /links/1': () => apiError(409, 'keyword_exists', { existingLink: other }),
    })
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Keyword' }), {
      target: { value: 'taken' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText(/go\/taken goes to/)).toBeInTheDocument()
  })

  it('refuses to save a keyword the organization rules reject, without asking the API', async () => {
    const api = drawerApi(ownLink, member)
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Keyword' }), {
      target: { value: 'Not A Keyword!' },
    })

    expect(await screen.findByText(/allows keywords matching/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    expect(api.callCount('PATCH /links/1')).toBe(0)
  })

  it('returns to the directory when closed', async () => {
    drawerApi(ownLink, member)
    const { router } = renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})

describe('the drawer another member sees', () => {
  it('is read-only, names the owner, and offers copy and open', async () => {
    stubClipboard()
    drawerApi(othersLink, member)
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })

    expect(screen.getByText(/Only the owner or an admin can change this link/)).toBeInTheDocument()
    expect(screen.getAllByText('jane@acme.com').length).toBeGreaterThan(0)
    expect(screen.getByRole('textbox', { name: 'Keyword' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Destination' })).toBeDisabled()
    expect(screen.getByLabelText('Unlisted')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete link' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy go/handbook' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open destination' })).toBeInTheDocument()
  })

  it('lets the destination be edited when the organization allows any member to', async () => {
    const editable = linkFixture({
      ...othersLink,
      permissions: {
        canEditDestination: true,
        canEdit: false,
        canDelete: false,
        canTransfer: false,
      },
    })
    drawerApi(editable, meFixture({ user: { id: '7', role: 'member' } }))
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    expect(screen.getByRole('textbox', { name: 'Destination' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Keyword' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })
})

describe('the drawer an admin sees', () => {
  it('adds an owner picker and says the drawer is being used as an admin', async () => {
    drawerApi(
      linkFixture({
        ...othersLink,
        permissions: {
          canEditDestination: true,
          canEdit: true,
          canDelete: true,
          canTransfer: true,
        },
      }),
      admin,
      {
        'GET /admin/users': {
          items: [adminUserFixture({ id: '9', email: 'jane@acme.com' })],
          nextCursor: null,
        },
      },
    )
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    expect(screen.getByText('Editing as admin')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Owner' })).toBeInTheDocument()
    expect(
      screen.getByText(
        'As an admin you can hand this link to another member, for example when someone leaves.',
      ),
    ).toBeInTheDocument()
  })

  it('reassigns the owner through the link itself', async () => {
    const api = drawerApi(
      linkFixture({
        ...othersLink,
        permissions: {
          canEditDestination: true,
          canEdit: true,
          canDelete: true,
          canTransfer: true,
        },
      }),
      admin,
      {
        'GET /admin/users': {
          items: [
            adminUserFixture({ id: '9', email: 'jane@acme.com' }),
            adminUserFixture({ id: '11', email: 'priya@acme.com' }),
          ],
          nextCursor: null,
        },
        'PATCH /links/1': () => jsonResponse(othersLink),
      },
    )
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    const owner = screen.getByRole('combobox', { name: 'Owner' })
    fireEvent.mouseDown(owner)
    fireEvent.click(await screen.findByRole('option', { name: 'priya@acme.com' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(api.callCount('PATCH /links/1')).toBe(1))
    expect(api.lastRequest('PATCH /links/1')?.json).toEqual({ ownerId: '11' })
  })
})

describe('deleting a link', () => {
  it('states the impact and deletes on confirmation', async () => {
    const api = drawerApi(ownLink, member, {
      'DELETE /links/1': () => new Response(null, { status: 204 }),
    })
    const { router } = renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete link' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/This cannot be undone/)).toBeInTheDocument()
    expect(within(dialog).getByText(/go\/handbook stops working/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox')).toBeNull()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete link' }))

    await waitFor(() => expect(api.callCount('DELETE /links/1')).toBe(1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('asks a well-used link to be named before it is deleted', async () => {
    const popular = linkFixture({ ...ownLink, visitCount: 4812 })
    const api = drawerApi(popular, member, {
      'DELETE /links/1': () => new Response(null, { status: 204 }),
    })
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete link' }))

    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: 'Delete link' })
    expect(confirm).toBeDisabled()

    const field = within(dialog).getByRole('textbox', { name: 'Type handbook to confirm' })
    fireEvent.change(field, { target: { value: 'hand' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(field, { target: { value: 'handbook' } })
    expect(confirm).toBeEnabled()

    fireEvent.click(confirm)
    await waitFor(() => expect(api.callCount('DELETE /links/1')).toBe(1))
  })
})

describe('a link that is no longer there', () => {
  it('says so instead of showing an empty form', async () => {
    stubApi({
      'GET /me': member,
      'GET /links': { items: [], nextCursor: null },
    })
    renderRoutes(routes, { path: '/_/links/1' })

    expect(await screen.findByText(/This link no longer exists/)).toBeInTheDocument()
  })
})

import type { AdminUser } from '@golinks/shared/api'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorResponse } from '../../../test/api.ts'
import { adminUserFixture, meFixture } from '../../../test/fixtures.ts'
import {
  idOf,
  listEnvelope,
  renderAdminAt,
  route,
  routeMatching,
  stubApi,
} from '../adminTestHarness.tsx'

/** The signed-in admin is `jane`, whose id matches the session fixture. */
const jane = adminUserFixture({ id: '7', email: 'jane@acme.com', role: 'admin', linkCount: 14 })
const sam = adminUserFixture({
  id: '8',
  email: 'sam@acme.com',
  role: 'member',
  roleSource: 'idp',
  linkCount: 31,
})
const dave = adminUserFixture({
  id: '9',
  email: 'dave@acme.com',
  role: 'member',
  isEnabled: false,
  linkCount: 12,
  lastLoginAt: null,
})

const asAdmin = route('GET', '/me', () => meFixture())

function members(...items: AdminUser[]) {
  return route('GET', '/admin/users', () => listEnvelope(items))
}

/** Every `GET /admin/users` the screen made, newest last. */
function memberRequests(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/admin/users'))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the members table', () => {
  it('shows each member with their role, status, links, and last sign-in', async () => {
    stubApi(asAdmin, members(jane, sam, dave))

    renderAdminAt('/_/admin/users')

    const daveRow = await screen.findByRole('row', { name: /dave@acme\.com/ })
    expect(within(daveRow).getByText('Member')).toBeInTheDocument()
    expect(within(daveRow).getByText('Disabled')).toBeInTheDocument()
    expect(within(daveRow).getByText('12 links')).toBeInTheDocument()
    expect(within(daveRow).getByText('Never')).toBeInTheDocument()
    expect(within(daveRow).getByText('DA')).toBeInTheDocument()

    const samRow = screen.getByRole('row', { name: /sam@acme\.com/ })
    expect(within(samRow).getByText('Active')).toBeInTheDocument()
    expect(within(samRow).getByText('31 links')).toBeInTheDocument()
    expect(screen.getByText('3 members')).toBeInTheDocument()
  })

  it('turns what is typed into one search request', async () => {
    const fetchMock = stubApi(asAdmin, members(jane, sam, dave))

    renderAdminAt('/_/admin/users')
    await screen.findByRole('row', { name: /sam@acme\.com/ })

    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'sam' } })

    await waitFor(() => {
      expect(memberRequests(fetchMock).at(-1)).toContain('q=sam')
    })
  })

  it('filters by role and by status from the chips', async () => {
    const fetchMock = stubApi(asAdmin, members(jane, sam, dave))

    renderAdminAt('/_/admin/users')
    await screen.findByRole('row', { name: /sam@acme\.com/ })

    fireEvent.click(screen.getByText('Admins'))
    await waitFor(() => expect(memberRequests(fetchMock).at(-1)).toContain('role=admin'))

    fireEvent.click(screen.getByText('Disabled'))
    await waitFor(() => expect(memberRequests(fetchMock).at(-1)).toContain('enabled=false'))

    fireEvent.click(screen.getByText('All'))
    await waitFor(() => {
      const last = memberRequests(fetchMock).at(-1) ?? ''
      expect(last).not.toContain('role=')
      expect(last).not.toContain('enabled=')
    })
  })

  it('pages with the cursor the API handed back', async () => {
    stubApi(
      asAdmin,
      route('GET', '/admin/users', (request) =>
        request.url.searchParams.get('cursor') === 'page-2'
          ? listEnvelope([dave])
          : listEnvelope([jane, sam], 'page-2'),
      ),
    )

    renderAdminAt('/_/admin/users')
    await screen.findByRole('row', { name: /sam@acme\.com/ })
    expect(screen.queryByRole('row', { name: /dave@acme\.com/ })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('row', { name: /dave@acme\.com/ })).toBeInTheDocument()
    expect(screen.getByText('3 members')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    stubApi(asAdmin, members())

    renderAdminAt('/_/admin/users')

    expect(await screen.findByText('No members match these filters.')).toBeInTheDocument()
  })
})

describe('the row menu', () => {
  it('disables a member and says what changed', async () => {
    const patched: unknown[] = []
    stubApi(
      asAdmin,
      members(jane, sam, dave),
      routeMatching('PATCH', /\/admin\/users\/\d+$/, (request) => {
        patched.push(request.body)
        return { ...sam, isEnabled: false }
      }),
    )

    renderAdminAt('/_/admin/users')
    await screen.findByRole('row', { name: /sam@acme\.com/ })

    fireEvent.click(screen.getByRole('button', { name: 'Actions for sam@acme.com' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable' }))

    expect(await screen.findByText('sam@acme.com can no longer sign in.')).toBeInTheDocument()
    expect(patched).toEqual([{ isEnabled: false }])
  })

  it('changes a role, and offers the opposite change on a disabled member', async () => {
    const patched: { id: string; body: unknown }[] = []
    stubApi(
      asAdmin,
      members(jane, sam, dave),
      routeMatching('PATCH', /\/admin\/users\/\d+$/, (request) => {
        patched.push({ id: idOf(request), body: request.body })
        return { ...dave, role: 'admin', roleSource: 'manual' }
      }),
    )

    renderAdminAt('/_/admin/users')
    await screen.findByRole('row', { name: /dave@acme\.com/ })

    fireEvent.click(screen.getByRole('button', { name: 'Actions for dave@acme.com' }))
    expect(await screen.findByRole('menuitem', { name: 'Enable' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make admin' }))

    expect(await screen.findByText('dave@acme.com is now an admin.')).toBeInTheDocument()
    expect(patched).toEqual([{ id: '9', body: { role: 'admin' } }])
  })

  it('will not open on the signed-in admin, and says why', async () => {
    stubApi(asAdmin, members(jane, sam, dave))

    renderAdminAt('/_/admin/users')
    await screen.findByRole('row', { name: /jane@acme\.com/ })

    const ownRow = screen.getByRole('button', { name: 'Actions for jane@acme.com' })
    expect(ownRow).toBeDisabled()

    fireEvent.mouseOver(ownRow.parentElement as HTMLElement)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'You cannot change your own account.',
    )
  })

  it('reports a refused self-modification as a notice', async () => {
    stubApi(
      asAdmin,
      members(jane, sam, dave),
      routeMatching('PATCH', /\/admin\/users\/\d+$/, () =>
        errorResponse(400, 'cannot_modify_self'),
      ),
    )

    renderAdminAt('/_/admin/users')
    await screen.findByRole('row', { name: /sam@acme\.com/ })

    fireEvent.click(screen.getByRole('button', { name: 'Actions for sam@acme.com' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Make admin' }))

    expect(await screen.findByText('You cannot change your own account.')).toBeInTheDocument()
  })

  it('offers no reassignment for a member who owns nothing', async () => {
    stubApi(
      asAdmin,
      members(jane, adminUserFixture({ id: '11', email: 'li@acme.com', linkCount: 0 })),
    )

    renderAdminAt('/_/admin/users')
    await screen.findByRole('row', { name: /li@acme\.com/ })

    fireEvent.click(screen.getByRole('button', { name: 'Actions for li@acme.com' }))

    expect(await screen.findByRole('menuitem', { name: 'Reassign links…' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

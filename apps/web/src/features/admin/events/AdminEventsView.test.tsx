import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminUserFixture, auditEventFixture, meFixture } from '../../../test/fixtures.ts'
import { listEnvelope, renderAdminAt, route, stubApi } from '../adminTestHarness.tsx'

const asAdmin = route('GET', '/me', () => meFixture())
const members = route('GET', '/admin/users', () =>
  listEnvelope([
    adminUserFixture({ id: '7', email: 'jane@acme.com' }),
    adminUserFixture({ id: '8', email: 'sam@acme.com' }),
  ]),
)

const roleChange = auditEventFixture({
  id: '902',
  type: 'user.updated',
  actorUserId: '7',
  objectType: 'user',
  objectId: '8',
  data: { changes: { role: ['member', 'admin'], isEnabled: [true, false] } },
})

const systemEvent = auditEventFixture({
  id: '903',
  type: 'link.created',
  actorUserId: null,
  objectType: 'link',
  objectId: '42',
  data: { keyword: 'meeting-notes', destination: 'https://docs.acme.com/notes' },
})

/** Every `GET /admin/events` the screen made, newest last. */
function eventRequests(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes('/admin/events'))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the audit trail', () => {
  it('shows who changed what, and the change itself', async () => {
    stubApi(
      asAdmin,
      members,
      route('GET', '/admin/events', () => listEnvelope([roleChange, systemEvent])),
    )

    renderAdminAt('/_/admin/events')

    const row = await screen.findByRole('row', { name: /user\.updated/ })
    expect(within(row).getByText('jane@acme.com')).toBeInTheDocument()
    expect(within(row).getByText('user 8')).toBeInTheDocument()
    expect(within(row).getByText('role: member → admin')).toBeInTheDocument()
    expect(within(row).getByText('isEnabled: true → false')).toBeInTheDocument()

    const created = screen.getByRole('row', { name: /link\.created/ })
    expect(within(created).getByText('System')).toBeInTheDocument()
    expect(within(created).getByText('keyword: meeting-notes')).toBeInTheDocument()
    expect(screen.getByText('2 events')).toBeInTheDocument()
  })

  it('filters by type, link, and member', async () => {
    const fetchMock = stubApi(
      asAdmin,
      members,
      route('GET', '/admin/events', () => listEnvelope([roleChange])),
    )

    renderAdminAt('/_/admin/events')
    await screen.findByRole('row', { name: /user\.updated/ })

    fireEvent.mouseDown(screen.getByLabelText('Type'))
    fireEvent.click(await screen.findByRole('option', { name: 'link.deleted' }))
    await waitFor(() => expect(eventRequests(fetchMock).at(-1)).toContain('type=link.deleted'))

    fireEvent.change(screen.getByLabelText('Link id'), { target: { value: '42' } })
    await waitFor(() => expect(eventRequests(fetchMock).at(-1)).toContain('linkId=42'))

    fireEvent.change(screen.getByLabelText('User id'), { target: { value: '8' } })
    await waitFor(() => expect(eventRequests(fetchMock).at(-1)).toContain('userId=8'))
  })

  it('pages with the cursor the API handed back', async () => {
    stubApi(
      asAdmin,
      members,
      route('GET', '/admin/events', (request) =>
        request.url.searchParams.get('cursor') === 'page-2'
          ? listEnvelope([systemEvent])
          : listEnvelope([roleChange], 'page-2'),
      ),
    )

    renderAdminAt('/_/admin/events')
    await screen.findByRole('row', { name: /user\.updated/ })

    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))

    expect(await screen.findByRole('row', { name: /link\.created/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('says so when nothing matches', async () => {
    stubApi(
      asAdmin,
      members,
      route('GET', '/admin/events', () => listEnvelope([])),
    )

    renderAdminAt('/_/admin/events')

    expect(await screen.findByText('No events match these filters.')).toBeInTheDocument()
  })
})

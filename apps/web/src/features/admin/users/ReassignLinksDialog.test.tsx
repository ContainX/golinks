import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorResponse } from '../../../test/api.ts'
import { adminUserFixture, linkFixture, meFixture } from '../../../test/fixtures.ts'
import {
  idOf,
  listEnvelope,
  renderAdminAt,
  route,
  routeMatching,
  stubApi,
} from '../adminTestHarness.tsx'

const jane = adminUserFixture({ id: '7', email: 'jane@acme.com', role: 'admin' })
const sam = adminUserFixture({ id: '8', email: 'sam@acme.com', role: 'member' })
const dave = adminUserFixture({
  id: '9',
  email: 'dave@acme.com',
  role: 'member',
  isEnabled: false,
  linkCount: 3,
})

const daveLinks = [
  linkFixture({ id: '41', fullPath: 'go/expenses', visitCount: 701 }),
  linkFixture({ id: '42', fullPath: 'go/vendors', visitCount: 388 }),
  linkFixture({ id: '43', fullPath: 'go/travel-policy', visitCount: 240 }),
]

const asAdmin = route('GET', '/me', () => meFixture())

/**
 * The members endpoint answers two different questions here: the table's page,
 * and the enabled members the chooser offers.
 */
const membersEndpoint = route('GET', '/admin/users', (request) =>
  request.url.searchParams.get('enabled') === 'true'
    ? listEnvelope([jane, sam])
    : listEnvelope([jane, sam, dave]),
)

const ownedLinks = route('GET', '/links', (request) =>
  request.url.searchParams.get('owner') === '9' ? listEnvelope(daveLinks) : listEnvelope([]),
)

/** Opens the dialog from the row menu, the way an admin reaches it. */
async function openDialog(): Promise<void> {
  await screen.findByRole('row', { name: /dave@acme\.com/ })
  fireEvent.click(screen.getByRole('button', { name: 'Actions for dave@acme.com' }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Reassign links…' }))
  await screen.findByRole('dialog')
}

/** Chooses the new owner in the autocomplete. */
async function chooseOwner(email: string): Promise<void> {
  const input = screen.getByLabelText('New owner')
  fireEvent.change(input, { target: { value: email } })
  fireEvent.click(await screen.findByRole('option', { name: email }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('reassigning a member’s links', () => {
  it('names the links, then hands each one over with its own request', async () => {
    const patched: { id: string; body: unknown }[] = []
    stubApi(
      asAdmin,
      membersEndpoint,
      ownedLinks,
      routeMatching('PATCH', /\/links\/\d+$/, (request) => {
        patched.push({ id: idOf(request), body: request.body })
        return { ...linkFixture({ id: idOf(request) }), owner: { id: '8', email: sam.email } }
      }),
    )

    renderAdminAt('/_/admin/users')
    await openDialog()

    expect(await screen.findByText('go/expenses')).toBeInTheDocument()
    expect(screen.getByText('701 visits')).toBeInTheDocument()
    expect(
      screen.getByText(/dave@acme\.com is disabled\. Their 3 links keep working/),
    ).toBeInTheDocument()

    await chooseOwner('sam@acme.com')
    fireEvent.click(screen.getByRole('button', { name: 'Reassign 3 links' }))

    expect(await screen.findByText('Moved 3 links to sam@acme.com.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(patched).toEqual([
      { id: '41', body: { ownerId: '8' } },
      { id: '42', body: { ownerId: '8' } },
      { id: '43', body: { ownerId: '8' } },
    ])
  })

  it('carries on past a link the API refuses and reports it', async () => {
    const patched: string[] = []
    stubApi(
      asAdmin,
      membersEndpoint,
      ownedLinks,
      routeMatching('PATCH', /\/links\/\d+$/, (request) => {
        const id = idOf(request)
        patched.push(id)
        if (id === '42') {
          return errorResponse(403, 'forbidden')
        }
        return { ...linkFixture({ id }), owner: { id: '8', email: sam.email } }
      }),
    )

    renderAdminAt('/_/admin/users')
    await openDialog()
    await screen.findByText('go/vendors')
    await chooseOwner('sam@acme.com')
    fireEvent.click(screen.getByRole('button', { name: 'Reassign 3 links' }))

    expect(await screen.findByText('1 link could not be reassigned')).toBeInTheDocument()
    expect(screen.getByText(/go\/vendors: forbidden happened\./)).toBeInTheDocument()
    // The two that went through are still reported, and the dialog stays open
    // on the one that did not.
    expect(patched).toEqual(['41', '42', '43'])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('will not start without a new owner', async () => {
    stubApi(asAdmin, membersEndpoint, ownedLinks)

    renderAdminAt('/_/admin/users')
    await openDialog()
    await screen.findByText('go/expenses')

    expect(screen.getByRole('button', { name: 'Reassign 3 links' })).toBeDisabled()
  })

  it('offers only enabled members, and never the member losing the links', async () => {
    stubApi(asAdmin, membersEndpoint, ownedLinks)

    renderAdminAt('/_/admin/users')
    await openDialog()
    await screen.findByText('go/expenses')

    fireEvent.change(screen.getByLabelText('New owner'), { target: { value: '@acme.com' } })

    const options = await screen.findAllByRole('option')
    expect(options.map((option) => option.textContent)).toEqual(['jane@acme.com', 'sam@acme.com'])
  })
})

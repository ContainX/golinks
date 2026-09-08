import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DirectoryPage } from '../../pages/DirectoryPage.tsx'
import { TransferPage } from '../../pages/TransferPage.tsx'
import { stubNavigation } from '../../test/api.ts'
import {
  linkFixture,
  meFixture,
  transferFixture,
  transferPreviewFixture,
} from '../../test/fixtures.ts'
import type { ApiHandler } from './testing.tsx'
import { apiError, jsonResponse, renderRoutes, stubApi, stubClipboard } from './testing.tsx'

const routes: RouteObject[] = [
  { path: '/', element: <DirectoryPage /> },
  { path: '/_/links/:id', element: <DirectoryPage /> },
  { path: '/_/transfer/:token', element: <TransferPage /> },
]

const me = meFixture({ user: { id: '7', email: 'sam@acme.com', role: 'member' } })

const ownLink = linkFixture({
  id: '1',
  displayKeyword: 'handbook',
  fullPath: 'go/handbook',
  owner: { id: '7', email: 'sam@acme.com' },
  visitCount: 42,
})

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('offering a link to someone else', () => {
  function transferApi(overrides: Record<string, ApiHandler> = {}) {
    return stubApi({
      'GET /me': me,
      'GET /links': { items: [], nextCursor: null },
      'GET /links/1': ownLink,
      'POST /links/1/transfers': () => jsonResponse(transferFixture(), 201),
      ...overrides,
    })
  }

  it('mints a URL when the dialog opens and offers it to be copied', async () => {
    const clipboard = stubClipboard()
    const api = transferApi()
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))

    const url = await screen.findByRole('textbox', { name: 'Transfer link' })
    expect(url).toHaveValue('https://links.example.com/_/transfer/tok-123')
    expect(screen.getByText(/^Expires/)).toBeInTheDocument()
    expect(api.callCount('POST /links/1/transfers')).toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Copy transfer link' }))
    await waitFor(() =>
      expect(clipboard.writeText).toHaveBeenCalledWith(
        'https://links.example.com/_/transfer/tok-123',
      ),
    )
    expect(await screen.findByText('Transfer link copied')).toBeInTheDocument()
  })

  it('explains a refusal and offers to try again', async () => {
    transferApi({ 'POST /links/1/transfers': () => apiError(403, 'read_only') })
    renderRoutes(routes, { path: '/_/links/1' })

    await screen.findByRole('heading', { name: 'go/handbook' })
    fireEvent.click(screen.getByRole('button', { name: 'Transfer' }))

    expect(await screen.findByText('read_only happened.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })
})

describe('accepting a transfer', () => {
  it('shows what is being taken on, then takes it on', async () => {
    const accepted = linkFixture({
      id: '42',
      fullPath: 'go/meeting-notes',
      owner: { id: '7', email: 'sam@acme.com' },
    })
    const api = stubApi({
      'GET /me': me,
      'GET /links': { items: [], nextCursor: null },
      'GET /links/42': accepted,
      'GET /transfers/tok-123': transferPreviewFixture(),
      'POST /transfers/tok-123/accept': () => jsonResponse(accepted),
    })
    const { router } = renderRoutes(routes, { path: '/_/transfer/tok-123' })

    expect(
      await screen.findByRole('heading', { name: 'Take ownership of go/meeting-notes?' }),
    ).toBeInTheDocument()
    expect(screen.getByText('https://docs.acme.com/notes')).toBeInTheDocument()
    expect(screen.getByText('jane@acme.com')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Take ownership' }))

    await waitFor(() => expect(api.callCount('POST /transfers/tok-123/accept')).toBe(1))
    await waitFor(() => expect(router.state.location.pathname).toBe('/_/links/42'))
  })

  it('explains an expired offer instead of showing the button', async () => {
    stubApi({
      'GET /me': me,
      'GET /transfers/tok-123': () => jsonResponse(transferPreviewFixture({ status: 'expired' })),
    })
    renderRoutes(routes, { path: '/_/transfer/tok-123' })

    expect(await screen.findByText('Transfer expired')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take ownership' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Back to directory' })).toBeInTheDocument()
  })

  it('explains an offer that was already used', async () => {
    stubApi({
      'GET /me': me,
      'GET /transfers/tok-123': () => jsonResponse(transferPreviewFixture({ status: 'accepted' })),
    })
    renderRoutes(routes, { path: '/_/transfer/tok-123' })

    expect(await screen.findByText('Already accepted')).toBeInTheDocument()
  })

  it('explains an offer that was withdrawn', async () => {
    stubApi({
      'GET /me': me,
      'GET /transfers/tok-123': () => jsonResponse(transferPreviewFixture({ status: 'revoked' })),
    })
    renderRoutes(routes, { path: '/_/transfer/tok-123' })

    expect(await screen.findByText('Transfer withdrawn')).toBeInTheDocument()
  })

  it('explains a token the API does not recognize, however it refuses', async () => {
    stubApi({
      'GET /me': me,
      'GET /transfers/tok-123': () => jsonResponse(transferPreviewFixture({ status: 'invalid' })),
    })
    renderRoutes(routes, { path: '/_/transfer/tok-123' })

    expect(await screen.findByText('Transfer not found')).toBeInTheDocument()
  })

  it('reads a refusal of the preview as the status it stands for', async () => {
    stubApi({
      'GET /me': me,
      'GET /transfers/gone': () => apiError(410, 'transfer_expired'),
    })
    renderRoutes(routes, { path: '/_/transfer/gone' })

    expect(await screen.findByText('Transfer expired')).toBeInTheDocument()
  })

  it('reads an unknown token as a transfer that is not there', async () => {
    stubApi({ 'GET /me': me, 'GET /transfers/nope': () => apiError(404, 'transfer_invalid') })
    renderRoutes(routes, { path: '/_/transfer/nope' })

    expect(await screen.findByText('Transfer not found')).toBeInTheDocument()
  })

  it('keeps the member on the page when acceptance is refused', async () => {
    stubApi({
      'GET /me': me,
      'GET /transfers/tok-123': transferPreviewFixture(),
      'POST /transfers/tok-123/accept': () => apiError(409, 'transfer_already_owner'),
    })
    const { router } = renderRoutes(routes, { path: '/_/transfer/tok-123' })

    fireEvent.click(await screen.findByRole('button', { name: 'Take ownership' }))

    expect(await screen.findByText('transfer_already_owner happened.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/_/transfer/tok-123')
  })
})

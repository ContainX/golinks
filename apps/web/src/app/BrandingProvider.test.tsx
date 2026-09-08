import { createTheme, useTheme } from '@mui/material/styles'
import { render, screen, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queryKeys } from '../queries/keys.ts'
import { errorResponse, jsonResponse, stubFetch, stubNavigation } from '../test/api.ts'
import { brandingFixture, meFixture } from '../test/fixtures.ts'
import { createTestQueryClient } from '../test/render.tsx'
import { AppProviders } from './AppProviders.tsx'
import { useBranding } from './BrandingProvider.tsx'

const SERVED_TITLE = 'GoLinks'
const SERVED_ICON = '/favicon.ico'

const stock = createTheme()

/** Reports what the tree below the provider actually sees. */
function BrandingProbe() {
  const theme = useTheme()
  const branding = useBranding()

  return (
    <div
      data-testid="probe"
      data-primary={theme.palette.primary.main}
      data-secondary={theme.palette.secondary.main}
      data-logo={branding?.logoUrl ?? 'none'}
      data-title={branding?.title ?? 'none'}
    >
      the app
    </div>
  )
}

function probe(): HTMLElement {
  return screen.getByTestId('probe')
}

function iconHref(): string | null {
  return document.head.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? null
}

function serveDocument(): void {
  document.title = SERVED_TITLE
  for (const link of document.head.querySelectorAll('link[rel~="icon"]')) {
    link.remove()
  }
  const link = document.createElement('link')
  link.rel = 'icon'
  link.setAttribute('href', SERVED_ICON)
  document.head.appendChild(link)
}

function renderApp(queryClient = createTestQueryClient()) {
  render(
    <AppProviders queryClient={queryClient}>
      <BrandingProbe />
    </AppProviders>,
  )
  return queryClient
}

let navigate: ReturnType<typeof stubNavigation>

beforeEach(() => {
  serveDocument()
  navigate = stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  serveDocument()
})

describe('BrandingProvider', () => {
  it('themes the app from the organization branding on /me (spec 06 §2)', async () => {
    stubFetch(
      jsonResponse(
        meFixture({
          organization: {
            branding: brandingFixture({
              title: 'Acme GoLinks',
              logoUrl: 'https://static.acme.com/logo.svg',
              faviconUrl: 'https://static.acme.com/icon.png',
              primaryColor: '#1f4b99',
              secondaryColor: '#d97706',
            }),
          },
        }),
      ),
    )

    renderApp()

    await waitFor(() => expect(probe().dataset.primary).toBe('#1f4b99'))
    expect(probe().dataset.secondary).toBe('#d97706')
    expect(probe().dataset.logo).toBe('https://static.acme.com/logo.svg')
    expect(document.title).toBe('Acme GoLinks')
    expect(iconHref()).toBe('https://static.acme.com/icon.png')
  })

  it('renders the stock theme while the session is still on its way', async () => {
    stubFetch(jsonResponse(meFixture()))

    renderApp()

    expect(probe().dataset.primary).toBe(stock.palette.primary.main)
    expect(probe().dataset.title).toBe('none')
    expect(document.title).toBe(SERVED_TITLE)

    await waitFor(() => expect(probe().dataset.title).toBe('GoLinks'))
  })

  it('shows the app in the stock theme, and no error, when there is no session', async () => {
    stubFetch(errorResponse(401, 'unauthenticated'))

    renderApp()

    // The transport is sending the browser to sign-in (spec 02 §2); the member
    // should not be handed an error about branding on the way out.
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(probe()).toHaveTextContent('the app')
    expect(probe().dataset.primary).toBe(stock.palette.primary.main)
    expect(probe().dataset.title).toBe('none')
    expect(document.title).toBe(SERVED_TITLE)
    expect(iconHref()).toBe(SERVED_ICON)
  })

  it('follows a change of branding without a rebuild or a reload', async () => {
    const queryClient = createTestQueryClient()
    stubFetch(jsonResponse(meFixture()))
    renderApp(queryClient)
    await waitFor(() => expect(probe().dataset.title).toBe('GoLinks'))

    // What an admin saving new settings amounts to: `/me` is read again and
    // answers with the branding they chose.
    act(() => {
      queryClient.setQueryData(
        queryKeys.me(),
        meFixture({
          organization: {
            branding: brandingFixture({
              title: 'Acme GoLinks',
              primaryColor: '#0f766e',
              faviconUrl: 'https://static.acme.com/icon.png',
            }),
          },
        }),
      )
    })

    await waitFor(() => expect(probe().dataset.primary).toBe('#0f766e'))
    expect(document.title).toBe('Acme GoLinks')
    expect(iconHref()).toBe('https://static.acme.com/icon.png')
  })

  it('puts back the served title and icon when an organization clears its branding', async () => {
    const queryClient = createTestQueryClient()
    stubFetch(jsonResponse(meFixture()))
    queryClient.setQueryData(
      queryKeys.me(),
      meFixture({
        organization: {
          branding: brandingFixture({
            title: 'Acme GoLinks',
            faviconUrl: 'https://static.acme.com/icon.png',
          }),
        },
      }),
    )
    renderApp(queryClient)
    await waitFor(() => expect(document.title).toBe('Acme GoLinks'))

    act(() => {
      queryClient.setQueryData(queryKeys.me(), meFixture())
    })

    await waitFor(() => expect(document.title).toBe('GoLinks'))
    expect(iconHref()).toBe(SERVED_ICON)
  })
})

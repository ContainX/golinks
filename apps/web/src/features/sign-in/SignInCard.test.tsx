import type { SignInOptions } from '@golinks/shared/api'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../app/AppProviders.tsx'
import { errorResponse, jsonResponse, stubNavigation } from '../../test/api.ts'
import { createTestQueryClient } from '../../test/render.tsx'
import { SignInCard } from './SignInCard.tsx'
import { SIGN_IN_ERROR_CODES, signInErrorMessage } from './signInMessages.ts'

const ME_URL = '/_/api/v1/me'
const PROVIDERS_URL = '/_/auth/providers'

const OKTA = { id: 'okta', label: 'Sign in with Okta', iconUrl: null }
const GOOGLE = { id: 'google', label: 'Sign in with Google Workspace', iconUrl: null }

/**
 * The endpoints this page reads: the public provider list, and `/me`, which
 * answers 401 because nobody is signed in — that is the whole reason the page
 * is on the screen.
 */
function stubApi(options: SignInOptions | 'unavailable'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === PROVIDERS_URL) {
        return options === 'unavailable'
          ? new Response('nope', { status: 503 })
          : jsonResponse(options)
      }
      if (url === ME_URL) {
        return errorResponse(401, 'unauthenticated')
      }
      return errorResponse(404, 'not_found')
    }),
  )
}

function renderSignIn(search = '') {
  render(
    <AppProviders queryClient={createTestQueryClient()}>
      <MemoryRouter initialEntries={[`/_/login${search}`]}>
        <SignInCard />
      </MemoryRouter>
    </AppProviders>,
  )
}

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the sign-in page', () => {
  it('offers one button per configured provider (spec 02 §2 step 1)', async () => {
    stubApi({ providers: [OKTA, GOOGLE], testSignIn: false })

    renderSignIn()

    expect(await screen.findByRole('link', { name: OKTA.label })).toHaveAttribute(
      'href',
      '/_/auth/start/okta',
    )
    expect(screen.getByRole('link', { name: GOOGLE.label })).toHaveAttribute(
      'href',
      '/_/auth/start/google',
    )
  })

  it('carries where the member was headed through the provider (spec 02 §2.2)', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn('?redirectTo=%2Feng%2Fdeploy%3Fvia%3Dsearch')

    expect(await screen.findByRole('link', { name: OKTA.label })).toHaveAttribute(
      'href',
      '/_/auth/start/okta?redirectTo=%2Feng%2Fdeploy%3Fvia%3Dsearch',
    )
  })

  it('shows a provider icon when the deployment configured one', async () => {
    stubApi({
      providers: [{ ...OKTA, iconUrl: 'https://static.acme.com/okta.svg' }],
      testSignIn: false,
    })

    renderSignIn()

    const button = await screen.findByRole('link', { name: OKTA.label })
    expect(button.querySelector('img')).toHaveAttribute('src', 'https://static.acme.com/okta.svg')
  })

  it('names the product, so a member can see which deployment they are signing in to', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn()

    expect(await screen.findByRole('heading', { name: 'Sign in to GoLinks' })).toBeInTheDocument()
  })
})

describe('sign-in failures', () => {
  it.each(SIGN_IN_ERROR_CODES)('says what went wrong for %s (spec 02 §2.1)', async (code) => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn(`?error=${code}`)

    const alert = await screen.findByText(signInErrorMessage(code) as string)
    expect(alert.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorError')
  })

  it('keeps the provider buttons, so the member can try again', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn('?error=login_state_mismatch')

    expect(await screen.findByRole('link', { name: OKTA.label })).toBeInTheDocument()
  })

  it('shows a general message for a code this build has never heard of', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn('?error=some_future_code')

    expect(await screen.findByText('Sign-in failed. Please try again.')).toBeInTheDocument()
    expect(screen.queryByText(/some_future_code/)).toBeNull()
  })

  it('says so when the provider list itself cannot be read', async () => {
    stubApi('unavailable')

    renderSignIn()

    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument()
  })
})

describe('signing out', () => {
  it('confirms that the member is signed out (spec 02 §4)', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn('?signedOut=1')

    expect(await screen.findByText(/You are signed out/)).toBeInTheDocument()
  })

  it('says nothing about signing out on an ordinary visit', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn()

    await screen.findByRole('link', { name: OKTA.label })
    expect(screen.queryByText(/signed out/)).toBeNull()
  })
})

describe('where the member was headed', () => {
  it('names the keyword they clicked', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn('?redirectTo=%2Fhandbook')

    expect(await screen.findByText(/You were headed to go\/handbook/)).toBeInTheDocument()
  })

  it('says nothing when they were headed for a screen rather than a link', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn('?redirectTo=%2F_%2Fadmin%2Fusers')

    await screen.findByRole('link', { name: OKTA.label })
    expect(screen.queryByText(/You were headed to/)).toBeNull()
  })

  it('says nothing when nothing was asked for', async () => {
    stubApi({ providers: [OKTA], testSignIn: false })

    renderSignIn()

    await screen.findByRole('link', { name: OKTA.label })
    expect(screen.queryByText(/You were headed to/)).toBeNull()
  })
})

describe('a deployment with no identity provider', () => {
  it('says that test sign-in is what this deployment uses (spec 02 §8)', async () => {
    stubApi({ providers: [], testSignIn: true })

    renderSignIn()

    expect(await screen.findByText(/test sign-in enabled/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Sign in with/ })).toBeNull()
  })

  it('says that nobody can sign in until an administrator configures one', async () => {
    stubApi({ providers: [], testSignIn: false })

    renderSignIn()

    await waitFor(() =>
      expect(screen.getByText(/No identity provider is configured/)).toBeInTheDocument(),
    )
  })
})

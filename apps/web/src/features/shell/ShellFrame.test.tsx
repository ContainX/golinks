import type { Me, MePatchBody, UserPreferences } from '@golinks/shared/api'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../app/AppProviders.tsx'
import { errorResponse, jsonResponse, stubNavigation } from '../../test/api.ts'
import { brandingFixture, meFixture } from '../../test/fixtures.ts'
import { createTestQueryClient } from '../../test/render.tsx'
import { SHORT_HOST_NOTICE_ID } from './notices.ts'
import { ShellFrame } from './ShellFrame.tsx'

const ME_URL = '/_/api/v1/me'

/** Where the shell's sign-out form posts (spec 02 §4). */
const SIGN_OUT_URL = '/_/auth/logout'

interface ApiStub {
  /** The bodies of every `PATCH /me` the shell sent, in order. */
  patched: MePatchBody[]
}

/**
 * A fetch that answers by address rather than in order: the shell reads `/me`,
 * writes preferences back to it, and posts to sign-out, and which of those
 * happens depends on what the test clicks.
 */
function stubApi(me: Me | null): ApiStub {
  const patched: MePatchBody[] = []
  let current = me

  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'

    if (url === ME_URL && method === 'GET') {
      return current === null ? errorResponse(401, 'unauthenticated') : jsonResponse(current)
    }
    if (url === ME_URL && method === 'PATCH' && current !== null) {
      const body = JSON.parse(String(init.body)) as MePatchBody
      patched.push(body)
      current = { ...current, user: { ...current.user, preferences: body.preferences } }
      return jsonResponse(current)
    }
    return errorResponse(404, 'not_found')
  })

  vi.stubGlobal('fetch', fetchMock)
  return { patched }
}

function renderShell(path = '/', children: ReactNode = <div>the screen</div>) {
  render(
    <AppProviders queryClient={createTestQueryClient()}>
      <MemoryRouter initialEntries={[path]}>
        <ShellFrame>{children}</ShellFrame>
      </MemoryRouter>
    </AppProviders>,
  )
}

function appBar(): HTMLElement {
  return screen.getByRole('banner')
}

/** Waits for `/me` to have arrived, which is when the chrome is complete. */
async function accountButton(email = 'jane@acme.com'): Promise<HTMLElement> {
  return await screen.findByRole('button', { name: new RegExp(email) })
}

async function openAccountMenu(email?: string): Promise<HTMLElement> {
  fireEvent.click(await accountButton(email))
  return await screen.findByRole('menu')
}

function memberFixture(preferences: UserPreferences = {}): Me {
  return meFixture({ user: { role: 'member', email: 'sam@acme.com', preferences } })
}

/**
 * The device's color-scheme preference. The test DOM has no `matchMedia` at
 * all, which Material UI reads as "no device preference" and answers by
 * setting no scheme; a browser always has one.
 */
function stubDevicePrefersDark(prefersDark: boolean, narrow = false): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    // Breakpoint queries ask about width; everything else here is a color-scheme query.
    matches: query.includes('max-width')
      ? narrow
      : query.includes('dark')
        ? prefersDark
        : !prefersDark,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  window.localStorage.clear()
  stubDevicePrefersDark(false)
  // A member with no session is answered 401, and the transport sends the
  // browser to sign-in; these tests are about the chrome, not that trip.
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-light')
  document.documentElement.removeAttribute('data-dark')
})

describe('the shell', () => {
  it('names the product and the organization once the session has arrived', async () => {
    stubApi(
      meFixture({
        organization: { branding: brandingFixture({ title: 'Acme GoLinks' }) },
      }),
    )

    renderShell()

    await accountButton()
    expect(appBar()).toHaveTextContent('Acme GoLinks')
    expect(appBar()).toHaveTextContent('acme.com')
  })

  it('offers the directory to a member and administration only to an admin', async () => {
    stubApi(memberFixture())
    renderShell()

    await accountButton('sam@acme.com')
    expect(within(appBar()).getByRole('link', { name: 'Directory' })).toHaveAttribute('href', '/')
    expect(within(appBar()).queryByRole('link', { name: 'Admin' })).toBeNull()
  })

  it('offers administration to an admin', async () => {
    stubApi(meFixture())
    renderShell()

    await accountButton()
    expect(within(appBar()).getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/_/admin',
    )
  })

  it('marks the section being looked at', async () => {
    stubApi(meFixture())
    renderShell('/_/admin/users')

    await accountButton()
    expect(within(appBar()).getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(appBar()).getByRole('link', { name: 'Directory' })).not.toHaveAttribute(
      'aria-current',
    )
  })

  it('shows the title and nothing else when there is no member', async () => {
    stubApi(null)

    renderShell('/_/login')

    // The sign-in page is inside the shell and is reached with no session at
    // all; there is no navigation to offer and no account to show.
    await waitFor(() => expect(appBar()).toHaveTextContent('GoLinks'))
    expect(screen.queryByRole('link', { name: 'Directory' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Open navigation/ })).toBeNull()
    expect(screen.getByText('the screen')).toBeInTheDocument()
  })

  it("shows the organization's links from settings", async () => {
    stubApi(
      meFixture({
        organization: {
          navigationLinks: [{ text: 'Runbooks', url: 'https://wiki.acme.com', adminOnly: false }],
        },
      }),
    )

    renderShell()

    await accountButton()
    expect(within(appBar()).getByRole('link', { name: /Runbooks/ })).toHaveAttribute(
      'href',
      'https://wiki.acme.com',
    )
  })

  it('keeps an admin-only navigation link from a member', async () => {
    stubApi(
      meFixture({
        user: { role: 'member', email: 'sam@acme.com' },
        organization: {
          navigationLinks: [{ text: 'Runbooks', url: 'https://wiki.acme.com', adminOnly: true }],
        },
      }),
    )

    renderShell()

    await accountButton('sam@acme.com')
    expect(within(appBar()).queryByRole('link', { name: /Runbooks/ })).toBeNull()
  })
})

describe('the organization banner', () => {
  it('shows the banner an admin set, at the level they chose', async () => {
    stubApi(
      meFixture({
        organization: {
          banner: {
            text: 'Read-only until Friday.',
            url: 'https://status.acme.com',
            level: 'warning',
          },
        },
      }),
    )

    renderShell()

    const banner = await screen.findByText('Read-only until Friday.')
    expect(banner.closest('.MuiAlert-root')).toHaveClass('MuiAlert-colorWarning')
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute(
      'href',
      'https://status.acme.com',
    )
  })

  it('shows nothing when the organization has set no banner', async () => {
    stubApi(meFixture())
    renderShell()

    await accountButton()
    expect(screen.queryByRole('link', { name: 'Learn more' })).toBeNull()
  })
})

describe('the short-host notice', () => {
  it('explains all three ways to make the short host resolve (spec 11)', async () => {
    stubApi(meFixture())
    renderShell()

    expect(await screen.findByText(/Make go\/ work in your browser/)).toBeInTheDocument()
    expect(screen.getByText(/CNAME/)).toBeInTheDocument()
    expect(screen.getByText(/hosts-file entry/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '/_/opensearch.xml' })).toBeInTheDocument()
    expect(screen.getByText('links.example.com')).toBeInTheDocument()
  })

  it('starts folded to its title on a narrow screen and opens on request', async () => {
    stubDevicePrefersDark(false, true)
    stubApi(meFixture())
    renderShell()

    expect(await screen.findByText(/Make go\/ work in your browser/)).toBeInTheDocument()
    expect(screen.queryByText(/hosts-file entry/)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show how' }))
    expect(await screen.findByText(/hosts-file entry/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(screen.queryByText(/hosts-file entry/)).toBeNull())
  })

  it('records a dismissal against the member, keeping the other preferences', async () => {
    const api = stubApi(meFixture({ user: { preferences: { colorScheme: 'dark' } } }))
    renderShell()

    fireEvent.click(await screen.findByRole('button', { name: 'Close' }))

    await waitFor(() => expect(api.patched).toHaveLength(1))
    expect(api.patched[0]).toEqual({
      preferences: { colorScheme: 'dark', dismissedNotices: [SHORT_HOST_NOTICE_ID] },
    })
    await waitFor(() => expect(screen.queryByText(/Make go\/ work/)).toBeNull())
  })

  it('stays closed for a member who has already dismissed it', async () => {
    stubApi(meFixture({ user: { preferences: { dismissedNotices: [SHORT_HOST_NOTICE_ID] } } }))

    renderShell()

    await accountButton()
    expect(screen.queryByText(/Make go\/ work/)).toBeNull()
  })

  it('is not shown to someone with no session', async () => {
    stubApi(null)
    renderShell('/_/login')

    await waitFor(() => expect(appBar()).toHaveTextContent('GoLinks'))
    expect(screen.queryByText(/Make go\/ work/)).toBeNull()
  })
})

describe('the account menu', () => {
  it('names the member, their role, and their organization', async () => {
    stubApi(memberFixture())
    renderShell()

    const menu = await openAccountMenu('sam@acme.com')
    expect(within(menu).getByText('sam@acme.com')).toBeInTheDocument()
    expect(within(menu).getByText('Member')).toBeInTheDocument()
    expect(within(menu).getByText('acme.com')).toBeInTheDocument()
  })

  it('signs out with a POST to the auth endpoint (spec 02 §4)', async () => {
    const submitted: HTMLFormElement[] = []
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function record(
      this: HTMLFormElement,
    ) {
      submitted.push(this)
    })
    stubApi(meFixture())
    renderShell()

    const menu = await openAccountMenu()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))

    await waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]?.method).toBe('post')
    expect(submitted[0]?.getAttribute('action')).toBe(SIGN_OUT_URL)
  })
})

describe('navigation on a narrow screen', () => {
  it('opens the sections in a drawer from the menu button', async () => {
    stubApi(meFixture())
    renderShell()

    await accountButton()
    expect(screen.queryByRole('navigation', { name: 'Sections menu' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))

    const drawer = await screen.findByRole('navigation', { name: 'Sections menu' })
    expect(within(drawer).getByRole('link', { name: 'Directory' })).toHaveAttribute('href', '/')
    expect(within(drawer).getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/_/admin')
  })

  it('offers no menu button to someone with no session', async () => {
    stubApi(null)
    renderShell('/_/login')

    await waitFor(() => expect(appBar()).toHaveTextContent('GoLinks'))
    expect(screen.queryByRole('button', { name: 'Open navigation' })).toBeNull()
  })
})

describe('the color scheme', () => {
  it('renders in the scheme the member stored (ADR 0002 §10)', async () => {
    stubApi(meFixture({ user: { preferences: { colorScheme: 'dark' } } }))

    renderShell()

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-dark'))
    expect(document.documentElement).not.toHaveAttribute('data-light')
  })

  it('follows the device when the member has stored nothing', async () => {
    stubDevicePrefersDark(true)
    stubApi(meFixture())

    renderShell()

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-dark'))
  })

  it('lets the member override the device', async () => {
    stubDevicePrefersDark(true)
    stubApi(meFixture({ user: { preferences: { colorScheme: 'light' } } }))

    renderShell()

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-light'))
    expect(document.documentElement).not.toHaveAttribute('data-dark')
  })

  it('applies a change at once and records it against the member', async () => {
    const api = stubApi(
      meFixture({ user: { preferences: { dismissedNotices: [SHORT_HOST_NOTICE_ID] } } }),
    )
    renderShell()

    const menu = await openAccountMenu()
    fireEvent.click(within(menu).getByRole('button', { name: 'Dark' }))

    await waitFor(() => expect(document.documentElement).toHaveAttribute('data-dark'))
    await waitFor(() => expect(api.patched).toHaveLength(1))
    expect(api.patched[0]).toEqual({
      preferences: { dismissedNotices: [SHORT_HOST_NOTICE_ID], colorScheme: 'dark' },
    })
  })

  it('shows which scheme is in force', async () => {
    stubApi(meFixture({ user: { preferences: { colorScheme: 'light' } } }))
    renderShell()

    const menu = await openAccountMenu()
    expect(within(menu).getByRole('button', { name: 'Light' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(menu).getByRole('button', { name: 'System' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })
})

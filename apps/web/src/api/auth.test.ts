import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorResponse, jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import {
  getSignInOptions,
  SIGN_IN_OPTIONS_PATH,
  SIGN_OUT_PATH,
  signInStartUrl,
  signOut,
} from './auth.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('signInStartUrl', () => {
  it('addresses the provider by id (spec 02 §2 step 2)', () => {
    expect(signInStartUrl('okta')).toBe('/_/auth/start/okta')
  })

  it('carries the path the member was trying to reach', () => {
    expect(signInStartUrl('okta', '/eng/deploy')).toBe(
      '/_/auth/start/okta?redirectTo=%2Feng%2Fdeploy',
    )
  })

  it('leaves the parameter off when there is nothing to carry', () => {
    expect(signInStartUrl('okta', null)).toBe('/_/auth/start/okta')
    expect(signInStartUrl('okta', '')).toBe('/_/auth/start/okta')
  })

  it('escapes a provider id, which is deployment-supplied', () => {
    expect(signInStartUrl('acme/okta')).toBe('/_/auth/start/acme%2Fokta')
  })
})

describe('getSignInOptions', () => {
  it('reads the endpoint outside the API base path', async () => {
    const fetchMock = stubFetch(jsonResponse({ providers: [], testSignIn: true }))

    await getSignInOptions()

    // `/_/auth` is served by the auth routes, not by `/_/api/v1` (spec 05 §3).
    expect(requestAt(fetchMock).url).toBe(SIGN_IN_OPTIONS_PATH)
  })

  it('parses the answer with the shared schema', async () => {
    stubFetch(
      jsonResponse({
        providers: [{ id: 'okta', label: 'Sign in with Okta', iconUrl: null }],
        testSignIn: false,
      }),
    )

    await expect(getSignInOptions()).resolves.toEqual({
      providers: [{ id: 'okta', label: 'Sign in with Okta', iconUrl: null }],
      testSignIn: false,
    })
  })

  it('does not send a member with no session anywhere', async () => {
    // The whole point of this page is that nobody is signed in yet; a 401
    // redirect here would bounce the browser off the screen it needs to show.
    const navigate = stubNavigation()
    stubFetch(errorResponse(401, 'unauthenticated'))

    await expect(getSignInOptions()).rejects.toThrow(/401/)
    expect(navigate).not.toHaveBeenCalled()
  })
})

describe('signOut', () => {
  /**
   * Watches the submission without letting the test DOM attempt it: a form
   * submit is a navigation, which jsdom does not perform.
   */
  function watchSubmissions(): () => HTMLFormElement[] {
    const submitted: HTMLFormElement[] = []
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function submitted_(
      this: HTMLFormElement,
    ) {
      submitted.push(this)
    })
    return () => submitted
  }

  it('posts, so the browser attaches the Origin the CSRF check wants (spec 02 §6)', () => {
    const submissions = watchSubmissions()

    signOut()

    const [form] = submissions()
    expect(form).toBeDefined()
    expect(form?.method).toBe('post')
    expect(form?.getAttribute('action')).toBe(SIGN_OUT_PATH)
  })

  it('submits a navigation, so the redirect it answers with is followed', () => {
    // The endpoint may send the browser to the identity provider's end-session
    // endpoint (spec 02 §4), which is another origin; only a navigation can
    // follow that.
    const submissions = watchSubmissions()

    signOut()

    expect(submissions()[0]?.isConnected).toBe(true)
  })

  it('keeps the form out of the way of the page it is leaving', () => {
    const submissions = watchSubmissions()

    signOut()

    expect(submissions()[0]?.hidden).toBe(true)
  })
})

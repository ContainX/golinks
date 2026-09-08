/**
 * The sign-in endpoints (spec 02 §2, spec 05 §3 "Non-API routes under `/_/`").
 *
 * These are the only endpoints the app talks to that are not under
 * `/_/api/v1`, so they do not go through {@link apiFetch}: its base path would
 * be wrong, and its 401 redirect would send a member who is *already* on the
 * sign-in page back to the endpoint that put them there. Both calls here are
 * plain fetches against absolute paths.
 */

import type { SignInOptions } from '@golinks/shared/api'
import { SignInOptionsSchema } from '@golinks/shared/api'
import type { RequestOptions } from './resource.ts'
import { parseResponse } from './resource.ts'

/** `GET /_/auth/providers`: what the sign-in page offers (spec 05 §3). Public. */
export const SIGN_IN_OPTIONS_PATH = '/_/auth/providers'

/** `POST /_/auth/logout`: destroys the session (spec 02 §4). */
export const SIGN_OUT_PATH = '/_/auth/logout'

/** Where sign-out lands when the deployment keeps it local (spec 02 §4). */
export const SIGNED_OUT_PATH = '/_/login?signedOut=1'

/**
 * The endpoint that hands the browser to one provider (spec 02 §2 step 2).
 *
 * `redirectTo` rides along so that a member who was trying to reach
 * `go/handbook` lands there rather than at the directory; the API sanitizes it
 * again on arrival (spec 02 §2.2), so nothing here depends on the value being
 * safe.
 */
export function signInStartUrl(providerId: string, redirectTo?: string | null): string {
  const path = `/_/auth/start/${encodeURIComponent(providerId)}`
  if (redirectTo === undefined || redirectTo === null || redirectTo === '') {
    return path
  }
  return `${path}?${new URLSearchParams({ redirectTo }).toString()}`
}

/**
 * `GET /_/auth/providers`: the configured providers and whether the deployment
 * accepts test sign-in.
 *
 * Answered to anyone, signed in or not — it reveals only what the buttons on
 * the sign-in page show anyway.
 */
export async function getSignInOptions({ signal }: RequestOptions = {}): Promise<SignInOptions> {
  const response = await fetch(SIGN_IN_OPTIONS_PATH, {
    headers: { Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) {
    throw new Error(`The sign-in options endpoint answered ${response.status}.`)
  }
  return parseResponse(SignInOptionsSchema, await response.json(), 'SignInOptions')
}

/**
 * Signs out, by submitting a form to `POST /_/auth/logout` (spec 02 §4).
 *
 * A form rather than a fetch, for two reasons. The browser attaches an
 * `Origin` header to a POST and refuses to let script set one, which is
 * exactly the CSRF check of spec 02 §6. And the endpoint answers with a
 * redirect the browser has to follow as a navigation: usually to the
 * signed-out page, but to the identity provider's end-session endpoint when
 * the deployment ends the session there too (spec 02 §4), and a cross-origin
 * redirect is not something `fetch` can follow on the app's behalf.
 *
 * There is nothing to await: the page it leads to is loaded from scratch.
 */
export function signOut(doc: Document = document): void {
  const form = doc.createElement('form')
  form.method = 'post'
  form.action = SIGN_OUT_PATH
  form.hidden = true
  doc.body.appendChild(form)
  form.submit()
}

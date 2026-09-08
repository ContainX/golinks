// `redirectTo` sanitization (spec 02 §2.2).
//
// Everything that sends a member somewhere after sign-in passes the requested path through
// here first: the sign-in page, the OIDC callback, the test sign-in, and the resolver's
// return-to-keyword gate. Anything that is not plainly a path on this service becomes `/`.

/** Where a member lands when nothing usable was asked for. */
export const DEFAULT_REDIRECT_TO = '/'

/** Characters a browser would never send in a path and a header-smuggling attempt might. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * Returns a path rooted at this service, or `/`.
 *
 * The value must start with a single `/` and may not start with `//` or `/\`, both of which a
 * browser reads as an authority and would turn into an open redirect. A relative path cannot
 * carry a scheme once those are excluded, so no further parsing is needed.
 */
export function sanitizeRedirectTo(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_REDIRECT_TO
  const path = value.trim()
  if (!path.startsWith('/')) return DEFAULT_REDIRECT_TO
  if (path.startsWith('//') || path.startsWith('/\\')) return DEFAULT_REDIRECT_TO
  if (CONTROL_CHARACTERS.test(path)) return DEFAULT_REDIRECT_TO
  return path
}

/** Where the service decides how a member signs in (spec 02 §2 step 1). */
export const SIGN_IN_PATH = '/_/auth/login'

/** The web app's sign-in page, which lists the providers and shows the message for an error. */
export const SIGN_IN_PAGE_PATH = '/_/login'

/**
 * The sign-in route, carrying the reason a member was sent back to it (spec 02 §2.1) and,
 * when there is one, the path they were trying to reach so a retry still lands there.
 */
export function signInPathWithError(code: string, redirectTo?: string): string {
  const parameters = new URLSearchParams({ error: code })
  const target = redirectTo === undefined ? DEFAULT_REDIRECT_TO : sanitizeRedirectTo(redirectTo)
  if (target !== DEFAULT_REDIRECT_TO) parameters.set('redirectTo', target)
  return `${SIGN_IN_PATH}?${parameters.toString()}`
}

/**
 * The web app's sign-in page (spec 02 §2 step 1). Only the parameters that say something are
 * carried, so the plain case is a bare `/_/login`.
 */
export function signInPageLocation(
  options: { redirectTo?: string | undefined; error?: string | undefined } = {},
): string {
  const parameters = new URLSearchParams()
  const target = sanitizeRedirectTo(options.redirectTo)
  if (target !== DEFAULT_REDIRECT_TO) parameters.set('redirectTo', target)
  if (options.error !== undefined) parameters.set('error', options.error)
  const query = parameters.toString()
  return query.length === 0 ? SIGN_IN_PAGE_PATH : `${SIGN_IN_PAGE_PATH}?${query}`
}

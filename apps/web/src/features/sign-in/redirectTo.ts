/**
 * Where a member was headed when they were asked to sign in (spec 02 §2.2).
 *
 * The resolver answers a keyword request from a member with no session with a
 * redirect to sign-in carrying the keyword's own path as `redirectTo`, so that
 * the trip through the identity provider ends where it started. Saying so on
 * the sign-in page turns an interruption into a detour: the member can see
 * that the link they clicked has not been lost.
 */

/**
 * The keyword `redirectTo` names, or `null` when it names something else.
 *
 * Route ownership (spec 04 §1) is the whole rule: `/` is the directory,
 * `/_/**` belongs to the app and the API, and every other path is a keyword.
 * A value that is not a plain path on this service names nothing — the API
 * would replace it with `/` anyway (spec 02 §2.2).
 */
export function keywordFromRedirectTo(redirectTo: string | null | undefined): string | null {
  if (typeof redirectTo !== 'string' || !redirectTo.startsWith('/')) {
    return null
  }
  if (redirectTo.startsWith('//') || redirectTo.startsWith('/\\')) {
    return null
  }
  const path = redirectTo.split(/[?#]/, 1)[0] ?? ''
  if (path === '/' || path === '/_' || path.startsWith('/_/')) {
    return null
  }
  const keyword = path.slice(1)
  return keyword === '' ? null : keyword
}

/** How that keyword is written and typed: `go/handbook` (spec 11). */
export function shortFormOf(shortHost: string, keyword: string): string {
  return `${shortHost}/${keyword}`
}

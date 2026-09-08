// Where a member is sent back to after a detour through sign-in (spec 02 §2.2).
//
// The resolver hands the keyword it was asked for to `/_/auth/login` so that the member lands
// back on it once a session exists. That value travels through the browser, so it is treated
// as untrusted input everywhere it is read: only a path rooted at this service survives.

/** The target a value that cannot be trusted is replaced by. */
export const DEFAULT_REDIRECT_TARGET = '/'

/** A scheme at the front turns a "path" into an absolute URL. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/** Characters that would let a target split the header it is written into. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: refusing them is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * Reduces a caller-supplied redirect target to a relative path (spec 02 §2.2).
 *
 * A usable target starts with a single `/`, does not start with `//` or `/\` (both of which a
 * browser reads as an authority), carries no scheme, and holds no control characters. Anything
 * else, a missing value included, becomes `/`.
 */
export function sanitizeRedirectTarget(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_REDIRECT_TARGET

  const target = value.trim()
  if (!target.startsWith('/')) return DEFAULT_REDIRECT_TARGET
  if (target.startsWith('//') || target.startsWith('/\\')) return DEFAULT_REDIRECT_TARGET
  if (SCHEME.test(target)) return DEFAULT_REDIRECT_TARGET
  if (CONTROL_CHARACTERS.test(target)) return DEFAULT_REDIRECT_TARGET

  return target
}

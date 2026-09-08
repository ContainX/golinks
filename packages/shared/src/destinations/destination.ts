/** Maximum length of a stored destination, in characters (spec 03 §3). */
export const MAX_DESTINATION_LENGTH = 4096

/** The scheme prepended to a destination that was typed without one (spec 03 §3). */
export const DEFAULT_DESTINATION_SCHEME = 'https://'

/** The schemes a destination may use. */
export const ALLOWED_DESTINATION_SCHEMES: readonly string[] = Object.freeze(['http:', 'https:'])

const SCHEME_PREFIX = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export type DestinationErrorCode = 'destination_invalid'

export type DestinationViolationReason =
  | 'empty'
  | 'too_long'
  | 'unparsable'
  | 'scheme_not_allowed'
  | 'empty_host'

export interface DestinationViolation {
  ok: false
  code: DestinationErrorCode
  reason: DestinationViolationReason
  message: string
}

export interface ValidatedDestination {
  ok: true
  /**
   * The stored form: the trimmed value after scheme defaulting, not the
   * parser's re-serialized form, so the directory shows what the owner typed.
   */
  destination: string
  /** Number of `%s` occurrences, for the placeholder rule (spec 03 §2.4). */
  placeholderCount: number
}

export type DestinationEvaluation = ValidatedDestination | DestinationViolation

function destinationViolation(
  reason: DestinationViolationReason,
  message: string,
): DestinationViolation {
  return { ok: false, code: 'destination_invalid', reason, message }
}

/**
 * True when the value already carries a scheme for the purposes of spec 03 §3
 * step 2: a scheme prefix that is followed by `//`. `https://wiki` has one;
 * `wiki.example.com:8080/x` and `javascript:alert(1)` do not, and both get
 * `https://` prepended (the latter then fails to parse).
 */
export function hasExplicitScheme(value: string): boolean {
  const match = SCHEME_PREFIX.exec(value)
  return match !== null && value.startsWith('//', match[0].length)
}

/** Trims the value and prepends `https://` when it has no scheme (spec 03 §3 steps 1-2). */
export function applyDefaultDestinationScheme(input: string): string {
  const trimmed = input.trim()
  if (trimmed.length === 0 || hasExplicitScheme(trimmed)) return trimmed
  return `${DEFAULT_DESTINATION_SCHEME}${trimmed}`
}

/** Counts the `%s` occurrences in a destination (spec 03 §3 step 7). */
export function countDestinationPlaceholders(destination: string): number {
  return destination.split('%s').length - 1
}

/**
 * Applies the destination rules of spec 03 §3 and returns the stored form.
 *
 * The length limit is checked before parsing rather than after, since both
 * paths report `destination_invalid` and there is no reason to parse a value
 * that is already too long to store.
 */
export function evaluateDestination(input: string): DestinationEvaluation {
  const destination = applyDefaultDestinationScheme(input)

  if (destination.length === 0) {
    return destinationViolation('empty', 'A destination must not be empty.')
  }

  if (destination.length > MAX_DESTINATION_LENGTH) {
    return destinationViolation(
      'too_long',
      `A destination must be at most ${MAX_DESTINATION_LENGTH} characters; this one is ${destination.length}.`,
    )
  }

  let url: URL
  try {
    url = new URL(destination)
  } catch {
    return destinationViolation('unparsable', `"${destination}" is not a valid URL.`)
  }

  if (!ALLOWED_DESTINATION_SCHEMES.includes(url.protocol)) {
    return destinationViolation(
      'scheme_not_allowed',
      `A destination must use http or https, not "${url.protocol.replace(/:$/, '')}".`,
    )
  }

  if (url.hostname.length === 0) {
    return destinationViolation('empty_host', `"${destination}" has no host.`)
  }

  return {
    ok: true,
    destination,
    placeholderCount: countDestinationPlaceholders(destination),
  }
}

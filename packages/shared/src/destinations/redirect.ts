const PLACEHOLDER = /%s/g

export interface BuiltRedirect {
  ok: true
  /** The value for the `Location` header: ASCII-safe and fully serialized. */
  location: string
}

export interface RedirectFailure {
  ok: false
  code: 'destination_unserializable'
  message: string
}

export type RedirectBuild = BuiltRedirect | RedirectFailure

/**
 * Substitutes captured placeholder values into a stored destination
 * (spec 04 §7). Each `%s` is replaced positionally with the matching value,
 * encoded with `encodeURIComponent`.
 *
 * Occurrences beyond the supplied values become the empty string, which is what
 * prefix fallback on a single segment needs (spec 04 §5.3); surplus values are
 * ignored. Substituted text is never rescanned, so a value cannot introduce a
 * new placeholder.
 */
export function substitutePlaceholders(destination: string, values: readonly string[]): string {
  let index = 0
  return destination.replace(PLACEHOLDER, () => {
    const value = values[index] ?? ''
    index += 1
    return encodeURIComponent(value)
  })
}

/**
 * Builds the `Location` value for a redirect (spec 04 §7): substitute first,
 * then serialize through the URL parser, which percent-encodes non-ASCII
 * characters and converts internationalized hosts to their ASCII form.
 *
 * Serialization can only fail for a stored destination that predates a rule
 * change; the resolver answers 502 rather than redirecting to garbage.
 */
export function buildRedirectLocation(
  destination: string,
  values: readonly string[] = [],
): RedirectBuild {
  const substituted = substitutePlaceholders(destination, values)

  try {
    return { ok: true, location: new URL(substituted).href }
  } catch {
    return {
      ok: false,
      code: 'destination_unserializable',
      message: `"${substituted}" could not be serialized as a URL.`,
    }
  }
}

// Turning a request path into a namespace and a keyword (spec 04 §4).
//
// Nothing here touches the database. The result carries three views of the same keyword: the
// segments as the member typed them (what a `%s` captures), their canonical form (what the
// unique index is searched with), and the display form (what the miss redirect pre-fills).

import {
  canonicalizeKeywordSegment,
  joinKeywordSegments,
  type KeywordRules,
} from '@golinks/shared/keywords'
import type { OrganizationSettings } from '@golinks/shared/settings'

/** A request path split into decoded segments, with the surrounding `/` already gone. */
export type RequestSegments = readonly string[]

export interface ParsedResolverRequest {
  /** The namespace the keyword is looked up in, spelled as links store it. */
  namespace: string
  /** True when `namespace` is the organization's default, which the miss redirect omits. */
  isDefaultNamespace: boolean
  /**
   * The keyword's segments as the member typed them, with the first one lowercased
   * (spec 04 §4 step 2). A `%s` captures these, so their case and punctuation survive.
   */
  segments: readonly string[]
  /** Each segment in canonical form (spec 03 §2.2). */
  canonicalSegments: readonly string[]
  /** The canonical segments joined; the key of the unique index. */
  canonicalKeyword: string
  /** The typed keyword path, punctuation intact, for the miss redirect (spec 04 §8). */
  displayKeywordPath: string
}

/**
 * Percent-decodes one path segment, leaving it alone when it is not valid encoding. A member
 * who types a stray `%` gets a miss rather than a 400.
 */
export function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Splits a request path into decoded segments (spec 04 §4 step 1).
 *
 * Segments are decoded one at a time rather than the path as a whole, so that a `%2F` inside a
 * placeholder value stays part of that value instead of becoming a separator. Surrounding `/`
 * are removed, which is why `/handbook/` and `/handbook` are the same request. A path with no
 * segments at all belongs to the web app, and the caller answers it without resolving.
 */
export function splitRequestPath(pathname: string): string[] {
  const trimmed = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmed.length === 0) return []
  return trimmed.split('/').map(decodePathSegment)
}

/**
 * The organization's namespace whose canonical form equals `head`, or undefined.
 *
 * Both sides are canonicalized because that is how the reserved-prefix rule of spec 03 §2.5
 * compares them: in a punctuation-insensitive organization `eng-tools` and `engtools` are the
 * same namespace, and a member may type either. The organization's default namespace is not a
 * candidate: `/go/handbook` means the keyword `go/handbook`, which is what makes creating
 * `go/eng` safe (spec 04 §9).
 */
export function detectNamespace(
  head: string,
  namespaces: readonly string[],
  rules: KeywordRules,
): string | undefined {
  const canonicalHead = canonicalizeKeywordSegment(head, rules)
  if (canonicalHead.length === 0) return undefined
  return namespaces.find(
    (namespace) => canonicalizeKeywordSegment(namespace, rules) === canonicalHead,
  )
}

/**
 * Applies spec 04 §4 to a request that has already been split into decoded segments.
 *
 * `segments` must be non-empty; a request with no segments is the web app's directory, not a
 * keyword.
 */
export function parseResolverRequest(
  segments: RequestSegments,
  settings: OrganizationSettings,
): ParsedResolverRequest {
  const rules = settings.keywords
  const head = (segments[0] ?? '').toLowerCase()
  const rest = segments.slice(1)

  const namespace =
    rest.length === 0 ? undefined : detectNamespace(head, settings.namespaces, rules)
  const keywordSegments = namespace === undefined ? [head, ...rest] : rest
  const canonicalSegments = keywordSegments.map((segment) =>
    canonicalizeKeywordSegment(segment, rules),
  )

  return {
    namespace: namespace ?? settings.defaultNamespace,
    isDefaultNamespace: namespace === undefined,
    segments: keywordSegments,
    canonicalSegments,
    canonicalKeyword: joinKeywordSegments(canonicalSegments),
    displayKeywordPath: joinKeywordSegments(keywordSegments),
  }
}

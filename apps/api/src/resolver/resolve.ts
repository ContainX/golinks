// The resolution algorithm (spec 04 §5).
//
// Pure apart from the two read-only queries it is handed, so the whole worked-examples table
// of spec 04 §9 can be driven against an in-memory lookup as well as against Postgres.

import {
  type KeywordRules,
  matchKeywordSegments,
  splitKeywordSegments,
} from '@golinks/shared/keywords'
import type { ParsedResolverRequest } from './parse.ts'

/** Everything the resolver needs from a stored link (spec 03 §1). */
export interface ResolvableLink {
  id: number
  namespace: string
  /** Canonical keyword: the form segments are compared in. */
  keyword: string
  /** Normalized as entered; what an error page shows the member. */
  displayKeyword: string
  segmentCount: number
  /** Greater than zero means the link is programmatic. */
  placeholderCount: number
  destination: string
  ownerId: number
}

/** The organization and namespace a lookup is confined to. Nothing crosses either. */
export interface LinkScope {
  organizationId: string
  namespace: string
}

export interface PrefixQuery {
  /** Only links with exactly this many segments, which is the pattern candidate set. */
  segmentCount?: number
  /** Only programmatic links (`placeholder_count > 0`). */
  programmaticOnly?: boolean
}

/**
 * The reads resolution performs. Two queries answer every case: the unique index for the exact
 * keyword, and one first-segment query for everything else.
 */
export interface ResolverLookup {
  /** The link whose canonical keyword is `canonicalKeyword`, through the unique index. */
  findExact(scope: LinkScope, canonicalKeyword: string): Promise<ResolvableLink | null>
  /** Links sharing a first segment, always ordered by keyword ascending for determinism. */
  findByPrefix(scope: LinkScope, prefix: string, query?: PrefixQuery): Promise<ResolvableLink[]>
  /** The email of a link's owner, read only when a redirect cannot be built (spec 04 §7). */
  findOwnerEmail(ownerId: number): Promise<string | null>
}

/** How a hit was reached. Worth logging, and worth asserting in tests. */
export type ResolutionRoute = 'exact' | 'pattern' | 'prefixFallback'

export interface ResolverHit {
  outcome: 'hit'
  route: ResolutionRoute
  link: ResolvableLink
  /** Captured `%s` values, in the order the keyword's placeholder segments appear. */
  values: string[]
  /** Request segments left over after a prefix-fallback hit, appended to the destination. */
  remainder: string[]
}

export interface ResolverMiss {
  outcome: 'miss'
}

export type Resolution = ResolverHit | ResolverMiss

const MISS: ResolverMiss = { outcome: 'miss' }

/** Just enough of a logger for the ambiguous-prefix warning of spec 04 §5.3. */
export interface ResolverLogger {
  warn(context: Record<string, unknown>, message: string): void
}

export interface ResolveOptions {
  organizationId: string
  rules: KeywordRules
  logger?: ResolverLogger
}

function hit(
  route: ResolutionRoute,
  link: ResolvableLink,
  values: string[],
  remainder: string[] = [],
): ResolverHit {
  return { outcome: 'hit', route, link, values, remainder }
}

/** The first candidate whose segments all match, with the values its `%s` segments captured. */
function matchPattern(
  candidates: readonly ResolvableLink[],
  request: ParsedResolverRequest,
  rules: KeywordRules,
): ResolverHit | undefined {
  for (const candidate of candidates) {
    if (candidate.placeholderCount === 0) continue
    if (candidate.segmentCount !== request.segments.length) continue
    const values = matchKeywordSegments(
      request.segments,
      splitKeywordSegments(candidate.keyword),
      rules,
    )
    if (values !== null) return hit('pattern', candidate, values)
  }
  return undefined
}

/**
 * Resolves one parsed request within its organization and namespace (spec 04 §5).
 *
 * The order is fixed: exact match, then pattern match, then prefix fallback when the
 * organization asks for it, then a miss. At most two queries run, whichever branch is taken:
 * in `prefixFallback` mode one first-segment query serves both the pattern candidates and the
 * fallback, because that mode allows only `a`, `a/%s`, `a/%s/%s`, ... under a first segment
 * (spec 03 §2.4).
 */
export async function resolveRequest(
  request: ParsedResolverRequest,
  lookup: ResolverLookup,
  options: ResolveOptions,
): Promise<Resolution> {
  const { rules, logger } = options
  const scope: LinkScope = {
    organizationId: options.organizationId,
    namespace: request.namespace,
  }
  const prefix = request.canonicalSegments[0] ?? ''
  const segmentCount = request.segments.length

  // 5.1 Exact match.
  const exact = await lookup.findExact(scope, request.canonicalKeyword)
  if (exact !== null) return hit('exact', exact, [])

  if (prefix.length === 0) return MISS

  if (rules.resolutionMode !== 'prefixFallback') {
    // 5.2 Pattern match. A single segment can only ever be an exact match.
    if (segmentCount < 2) return MISS
    const candidates = await lookup.findByPrefix(scope, prefix, {
      segmentCount,
      programmaticOnly: true,
    })
    return matchPattern(candidates, request, rules) ?? MISS
  }

  const sharingPrefix = await lookup.findByPrefix(scope, prefix)

  if (segmentCount >= 2) {
    // 5.2 Pattern match, then 5.3 fallback onto the first segment with the rest appended.
    const pattern = matchPattern(sharingPrefix, request, rules)
    if (pattern !== undefined) return pattern

    const stem = sharingPrefix.find((link) => link.keyword === prefix)
    if (stem === undefined) return MISS
    return hit('prefixFallback', stem, [], [...request.segments.slice(1)])
  }

  // 5.3 One segment: the programmatic link under this prefix, with empty placeholder values.
  const programmatic = sharingPrefix.filter((link) => link.placeholderCount > 0)
  const first = programmatic[0]
  if (first === undefined) return MISS

  if (programmatic.length > 1) {
    logger?.warn(
      {
        organizationId: scope.organizationId,
        namespace: scope.namespace,
        prefix,
        candidates: programmatic.map((link) => link.keyword),
        chosen: first.keyword,
      },
      'more than one programmatic link shares this first segment; prefix fallback took the first',
    )
  }

  return hit('prefixFallback', first, [])
}

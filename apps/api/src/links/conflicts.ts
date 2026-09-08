// Keyword conflict detection (spec 03 §6.1).
//
// Two keywords conflict when one would swallow the other at resolution time, so the checks
// here are the resolution algorithm of spec 04 §5 read backwards: whatever the resolver
// would reach for a request is what a new keyword must not collide with.
//
//   1. the same canonical keyword already exists                     -> keyword_exists
//   2. the new keyword would pattern-match an existing programmatic
//      link, the way spec 04 §5.2 matches a request                  -> keyword_conflict
//   3. the new keyword is programmatic and its `%s` segments would
//      stand in for an existing link's segments                      -> keyword_conflict
//   4. under prefixFallback (spec 04 §5.3) a single-segment keyword
//      and a programmatic keyword sharing that segment collide       -> keyword_conflict
//
// Everything is compared on canonical keywords inside one organization and namespace, and
// every check runs against the same candidate set: the links sharing the new keyword's
// first segment. The caller holds the advisory lock for that triple (see `locking.ts`), so
// a concurrent request cannot slip a row past the checks.

import {
  type EvaluatedKeyword,
  isPlaceholderSegment,
  type KeywordRules,
  matchKeywordSegments,
  splitKeywordSegments,
} from '@golinks/shared/keywords'
import type { DatabaseExecutor } from '../audit/index.ts'
import type { LinkRow } from '../db/schema/index.ts'
import { findByPrefix, findExact } from './repository.ts'
import { linkFullPath } from './resource.ts'

/** Which of the four cases of spec 03 §6.1 fired. */
export type KeywordConflictReason =
  | 'exact'
  | 'pattern_match'
  | 'programmatic_overlap'
  | 'prefix_fallback'

export interface KeywordConflict {
  ok: false
  /** `keyword_exists` for case 1, `keyword_conflict` for the rest (spec 05 §4). */
  code: 'keyword_exists' | 'keyword_conflict'
  reason: KeywordConflictReason
  message: string
  /** The link that stands in the way; the caller returns it as `existingLink`. */
  existing: LinkRow
}

export type KeywordConflictResult = { ok: true } | KeywordConflict

export interface KeywordConflictQuery {
  organizationId: string
  namespace: string
  /** The keyword being created or renamed to, already through the rules of spec 03 §2. */
  evaluation: EvaluatedKeyword
  rules: KeywordRules
  /** The link being renamed, so that it never conflicts with itself (spec 03 §7). */
  excludeLinkId?: number
}

/** Runs the four checks in the order spec 03 §6.1 lists them and stops at the first hit. */
export async function detectKeywordConflict(
  tx: DatabaseExecutor,
  query: KeywordConflictQuery,
): Promise<KeywordConflictResult> {
  const { organizationId, namespace, evaluation, rules, excludeLinkId } = query

  const exact = await findExact(tx, organizationId, namespace, evaluation.canonicalKeyword)
  if (exact !== undefined && exact.id !== excludeLinkId) {
    return {
      ok: false,
      code: 'keyword_exists',
      reason: 'exact',
      message: `${linkFullPath(exact)} already exists.`,
      existing: exact,
    }
  }

  // Cases 2 and 3 only ever compare keywords of the same length, so in standard mode the
  // candidate set narrows to that segment count. Case 4 deliberately compares across
  // lengths, so prefixFallback loads the whole prefix.
  const candidates = await findByPrefix(tx, organizationId, namespace, evaluation.prefix, {
    ...(rules.resolutionMode === 'prefixFallback' ? {} : { segmentCount: evaluation.segmentCount }),
    ...(excludeLinkId === undefined ? {} : { excludeLinkId }),
  })

  const patternMatch = findPatternMatch(evaluation, candidates, rules)
  if (patternMatch !== undefined) {
    return {
      ok: false,
      code: 'keyword_conflict',
      reason: 'pattern_match',
      message: `${evaluation.displayKeyword} would already resolve through ${linkFullPath(patternMatch)}.`,
      existing: patternMatch,
    }
  }

  const overlap = findProgrammaticOverlap(evaluation, candidates)
  if (overlap !== undefined) {
    return {
      ok: false,
      code: 'keyword_conflict',
      reason: 'programmatic_overlap',
      message: `${evaluation.displayKeyword} would stand in for ${linkFullPath(overlap)}.`,
      existing: overlap,
    }
  }

  const prefixConflict = findPrefixFallbackConflict(evaluation, candidates, rules)
  if (prefixConflict !== undefined) {
    return {
      ok: false,
      code: 'keyword_conflict',
      reason: 'prefix_fallback',
      message: `In prefix fallback mode ${evaluation.displayKeyword} and ${linkFullPath(prefixConflict)} cannot both exist.`,
      existing: prefixConflict,
    }
  }

  return { ok: true }
}

/**
 * Case 2: the new keyword, read as if it were a request path, reaches an existing
 * programmatic link. This is `matchKeywordSegments`, the very function the resolver uses
 * (spec 04 §5.2), which is why creating `jira/abc` fails while `jira/%s` exists.
 */
function findPatternMatch(
  evaluation: EvaluatedKeyword,
  candidates: readonly LinkRow[],
  rules: KeywordRules,
): LinkRow | undefined {
  if (evaluation.segmentCount < 2) return undefined
  return candidates.find(
    (candidate) =>
      candidate.placeholderCount > 0 &&
      candidate.segmentCount === evaluation.segmentCount &&
      matchKeywordSegments(evaluation.segments, splitKeywordSegments(candidate.keyword), rules) !==
        null,
  )
}

/**
 * Case 3: the new keyword is programmatic and, segment for segment, either equals an
 * existing keyword or has a placeholder standing where the other side has something. That
 * is what makes `jira/%s` collide with `jira/abc`, and `gh/%s/%s` with another spelling of
 * itself.
 */
function findProgrammaticOverlap(
  evaluation: EvaluatedKeyword,
  candidates: readonly LinkRow[],
): LinkRow | undefined {
  if (!evaluation.isProgrammatic) return undefined
  return candidates.find(
    (candidate) =>
      candidate.segmentCount === evaluation.segmentCount &&
      segmentsOverlap(evaluation.segments, splitKeywordSegments(candidate.keyword)),
  )
}

function segmentsOverlap(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  return left.every((segment, index) => {
    const other = right[index] ?? ''
    return segment === other || isPlaceholderSegment(segment) || isPlaceholderSegment(other)
  })
}

/**
 * Case 4: under prefixFallback a request for `/example` falls through to a programmatic
 * `example/%s`, and a request for `/example/anything` falls through to a plain `example`
 * (spec 04 §5.3). The two therefore cannot coexist, in either order.
 */
function findPrefixFallbackConflict(
  evaluation: EvaluatedKeyword,
  candidates: readonly LinkRow[],
  rules: KeywordRules,
): LinkRow | undefined {
  if (rules.resolutionMode !== 'prefixFallback') return undefined

  if (evaluation.segmentCount === 1) {
    return candidates.find((candidate) => candidate.placeholderCount > 0)
  }

  if (!evaluation.isProgrammatic) return undefined
  return candidates.find((candidate) => candidate.segmentCount === 1)
}

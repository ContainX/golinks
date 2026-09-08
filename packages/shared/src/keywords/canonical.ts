import type { KeywordRules } from './rules.ts'
import { joinKeywordSegments, splitKeywordSegments } from './segments.ts'
import { type KeywordViolation, keywordViolation } from './violations.ts'

/**
 * Every ASCII punctuation character except `/`, which separates segments, and
 * `%`, which forms the `%s` placeholder (spec 03 §2.2).
 */
const REMOVABLE_PUNCTUATION = /[!"#$&'()*+,\-.:;<=>?@[\\\]^_`{|}~]/g

/**
 * Canonicalizes one segment (spec 03 §2.2).
 *
 * Canonical keywords are lowercase by construction, because normalization
 * (§2.1) lowercases before the canonical form is derived. Lowercasing here is
 * therefore idempotent for stored keywords, and it lets the resolver compare a
 * raw request segment against a stored one without a separate step.
 */
export function canonicalizeKeywordSegment(segment: string, rules: KeywordRules): string {
  const lowercased = segment.toLowerCase()
  if (rules.punctuationSensitive) return lowercased
  return lowercased.replace(REMOVABLE_PUNCTUATION, '')
}

export interface CanonicalKeyword {
  ok: true
  /** The form used for lookups, uniqueness, and conflict checks (spec 03 §2.2). */
  canonicalKeyword: string
  /** The canonical keyword split on `/`. */
  segments: string[]
}

export type KeywordCanonicalization = CanonicalKeyword | KeywordViolation

/**
 * Derives the canonical keyword from a display keyword (spec 03 §2.2). In a
 * punctuation-sensitive organization the canonical keyword equals the display
 * keyword. Otherwise punctuation is dropped from each segment, and a segment
 * that collapses to nothing makes the keyword invalid.
 */
export function canonicalizeKeyword(
  displayKeyword: string,
  rules: KeywordRules,
): KeywordCanonicalization {
  const segments = splitKeywordSegments(displayKeyword).map((segment) =>
    canonicalizeKeywordSegment(segment, rules),
  )

  const emptyIndex = segments.findIndex((segment) => segment.length === 0)
  if (emptyIndex !== -1) {
    return keywordViolation(
      'keyword_invalid',
      'canonical_empty_segment',
      `Segment ${emptyIndex + 1} of "${displayKeyword}" is nothing but punctuation, so it disappears in this organization's canonical form.`,
    )
  }

  return { ok: true, canonicalKeyword: joinKeywordSegments(segments), segments }
}

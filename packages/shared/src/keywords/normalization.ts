import { MAX_KEYWORD_LENGTH, MAX_KEYWORD_SEGMENTS } from './rules.ts'
import { splitKeywordSegments } from './segments.ts'
import { type KeywordViolation, keywordViolation } from './violations.ts'

export interface NormalizedKeyword {
  ok: true
  /** The keyword as the member entered it, normalized (spec 03 §2.1). */
  displayKeyword: string
  /** The display keyword split on `/`. */
  segments: string[]
}

export type KeywordNormalization = NormalizedKeyword | KeywordViolation

const SURROUNDING_SEPARATORS = /^\/+|\/+$/g

/**
 * Normalizes a keyword received from a client (spec 03 §2.1): trim, lowercase,
 * strip surrounding `/`, then reject empty keywords, empty segments, keywords
 * longer than 200 characters, and keywords with more than 10 segments.
 *
 * The result is the display keyword. Every failure maps to `keyword_invalid`;
 * the `reason` says which of the four rules was broken.
 */
export function normalizeKeyword(input: string): KeywordNormalization {
  const displayKeyword = input.trim().toLowerCase().replace(SURROUNDING_SEPARATORS, '')

  if (displayKeyword.length === 0) {
    return keywordViolation('keyword_invalid', 'empty', 'A keyword must not be empty.')
  }

  const segments = splitKeywordSegments(displayKeyword)

  if (segments.some((segment) => segment.length === 0)) {
    return keywordViolation(
      'keyword_invalid',
      'empty_segment',
      'A keyword must not contain an empty segment, such as in "a//b".',
    )
  }

  if (displayKeyword.length > MAX_KEYWORD_LENGTH) {
    return keywordViolation(
      'keyword_invalid',
      'too_long',
      `A keyword must be at most ${MAX_KEYWORD_LENGTH} characters; this one is ${displayKeyword.length}.`,
    )
  }

  if (segments.length > MAX_KEYWORD_SEGMENTS) {
    return keywordViolation(
      'keyword_invalid',
      'too_many_segments',
      `A keyword must have at most ${MAX_KEYWORD_SEGMENTS} segments; this one has ${segments.length}.`,
    )
  }

  return { ok: true, displayKeyword, segments }
}

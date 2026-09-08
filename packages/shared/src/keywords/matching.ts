import { canonicalizeKeywordSegment } from './canonical.ts'
import type { KeywordRules } from './rules.ts'
import { isPlaceholderSegment } from './segments.ts'

/**
 * Matches a request's segments against a programmatic keyword's segments
 * (spec 04 §5.2).
 *
 * A `%s` segment captures the raw request segment, so placeholder values keep
 * their case and their punctuation. Any other segment must equal the
 * canonicalized request segment. Returns the captured values in order, or null
 * when the segment counts differ or a literal segment does not match.
 *
 * `keywordSegments` are the stored canonical segments of the link.
 */
export function matchKeywordSegments(
  requestSegments: readonly string[],
  keywordSegments: readonly string[],
  rules: KeywordRules,
): string[] | null {
  if (requestSegments.length !== keywordSegments.length) return null

  const captured: string[] = []

  for (const [index, keywordSegment] of keywordSegments.entries()) {
    const requestSegment = requestSegments[index] ?? ''
    if (isPlaceholderSegment(keywordSegment)) {
      captured.push(requestSegment)
      continue
    }
    if (canonicalizeKeywordSegment(requestSegment, rules) !== keywordSegment) return null
  }

  return captured
}

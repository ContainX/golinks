import type { KeywordRules } from './rules.ts'
import { KEYWORD_PLACEHOLDER } from './segments.ts'
import { KEYWORD_CHECK_OK, type KeywordCheck, keywordViolation } from './violations.ts'

/** The prefix the application reserves for its own routes under `/_/`. */
export const RESERVED_KEYWORD_PREFIX = '_'

/**
 * Compiles an organization's `keywords.allowedPattern`, or returns null when the
 * source is not a valid regular expression. The web app can hold on to the
 * compiled pattern to check keywords as they are typed.
 */
export function compileAllowedPattern(allowedPattern: string): RegExp | null {
  try {
    return new RegExp(allowedPattern)
  } catch {
    return null
  }
}

/**
 * The invariants that hold whatever the organization's allowed pattern says
 * (spec 03 §2.3):
 *
 * - the keyword must not start with `_`, because `/_/` belongs to the application;
 * - `%` may only appear as the placeholder segment `%s`;
 * - segments are separated by exactly one `/`, so no segment is empty.
 *
 * Takes the display keyword's segments, which normalization has already produced.
 */
export function checkKeywordInvariants(segments: readonly string[]): KeywordCheck {
  const first = segments[0]

  if (first === undefined || segments.some((segment) => segment.length === 0)) {
    return keywordViolation(
      'keyword_invalid',
      'empty_segment',
      'Keyword segments are separated by exactly one "/", so no segment may be empty.',
    )
  }

  if (first.startsWith(RESERVED_KEYWORD_PREFIX)) {
    return keywordViolation(
      'keyword_reserved',
      'reserved_prefix',
      'A keyword must not start with "_". Paths under /_/ belong to the application.',
    )
  }

  for (const segment of segments) {
    if (segment.includes('%') && segment !== KEYWORD_PLACEHOLDER) {
      return keywordViolation(
        'keyword_invalid',
        'placeholder_character',
        `"%" may only appear as the placeholder segment "${KEYWORD_PLACEHOLDER}", not inside "${segment}".`,
      )
    }
  }

  return KEYWORD_CHECK_OK
}

/**
 * Checks the display keyword against the organization's allowed pattern
 * (spec 03 §2.3). A pattern that does not compile is reported rather than
 * thrown, so a bad settings document cannot take down a request.
 */
export function checkAllowedPattern(displayKeyword: string, rules: KeywordRules): KeywordCheck {
  const pattern = compileAllowedPattern(rules.allowedPattern)

  if (pattern === null) {
    return keywordViolation(
      'keyword_invalid',
      'pattern_invalid',
      `This organization's allowed keyword pattern is not a valid regular expression: ${rules.allowedPattern}`,
    )
  }

  if (!pattern.test(displayKeyword)) {
    return keywordViolation(
      'keyword_invalid',
      'pattern_mismatch',
      `"${displayKeyword}" does not match this organization's allowed keyword pattern ${rules.allowedPattern}.`,
    )
  }

  return KEYWORD_CHECK_OK
}

import type { KeywordRules } from './rules.ts'
import { isPlaceholderSegment, KEYWORD_PLACEHOLDER } from './segments.ts'
import { KEYWORD_CHECK_OK, type KeywordCheck, keywordViolation } from './violations.ts'

/**
 * The placeholder position rules (spec 03 §2.4):
 *
 * - the first segment must not be a placeholder;
 * - once a placeholder appears every following segment must also be one, so
 *   `jira/%s`, `gh/%s/%s`, and `docs/api/%s` are valid while `gh/%s/issues` is not;
 * - under `prefixFallback` resolution the second segment, when present, must be
 *   the placeholder, because hierarchical keywords are not available in that mode.
 *
 * The count rule against the destination lives with the destination rules,
 * which are the other half of that comparison.
 */
export function checkPlaceholderPositions(
  segments: readonly string[],
  rules: KeywordRules,
): KeywordCheck {
  const first = segments[0]

  if (first !== undefined && isPlaceholderSegment(first)) {
    return keywordViolation(
      'placeholder_invalid',
      'placeholder_first_segment',
      `The first segment of a keyword must not be the placeholder "${KEYWORD_PLACEHOLDER}".`,
    )
  }

  let seenPlaceholder = false
  for (const segment of segments) {
    if (isPlaceholderSegment(segment)) {
      seenPlaceholder = true
      continue
    }
    if (seenPlaceholder) {
      return keywordViolation(
        'placeholder_invalid',
        'placeholder_not_trailing',
        `Once a segment is "${KEYWORD_PLACEHOLDER}", every following segment must be "${KEYWORD_PLACEHOLDER}" too, so "${segment}" cannot follow one.`,
      )
    }
  }

  const second = segments[1]
  if (
    rules.resolutionMode === 'prefixFallback' &&
    second !== undefined &&
    !isPlaceholderSegment(second)
  ) {
    return keywordViolation(
      'placeholder_invalid',
      'placeholder_second_segment_required',
      `In prefixFallback resolution mode the second segment must be "${KEYWORD_PLACEHOLDER}"; hierarchical keywords are not available in that mode.`,
    )
  }

  return KEYWORD_CHECK_OK
}

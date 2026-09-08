/**
 * Checking a keyword and a destination while the member is still typing.
 *
 * The rules are the organization's own (spec 03 §2, §3) and they are the same
 * ones the API applies, so the checks run against the shared helpers rather
 * than a second copy of the grammar. The point is not to replace the API's
 * answer — creation is still validated there — but to say what is wrong before
 * a request goes out, and to keep the wording short enough for a field.
 */

import {
  checkPlaceholderCounts,
  countDestinationPlaceholders,
  evaluateDestination,
} from '@golinks/shared/destinations'
import type { KeywordViolation } from '@golinks/shared/keywords'
import {
  countPlaceholderSegments,
  evaluateKeyword,
  MAX_KEYWORD_LENGTH,
  MAX_KEYWORD_SEGMENTS,
  splitKeywordSegments,
} from '@golinks/shared/keywords'
import type { KeywordRules } from '@golinks/shared/settings'

/** Where the keyword is being created, for the reserved-prefix rule (spec 03 §2.5). */
export interface NamespaceContext {
  namespace: string
  defaultNamespace: string
  namespaces: readonly string[]
}

/**
 * Field wording for a rule that failed.
 *
 * The shared violations carry messages written for an API response, which name
 * the whole regular expression and quote the offending keyword. Under a text
 * field there is room for one line, so each rule gets a phrasing of its own and
 * anything unforeseen falls back to the shared message.
 */
function keywordMessage(violation: KeywordViolation, rules: KeywordRules): string {
  switch (violation.reason) {
    case 'empty':
      return 'A keyword is required.'
    case 'empty_segment':
      return 'Segments are separated by a single "/", so none may be empty.'
    case 'too_long':
      return `A keyword may be at most ${MAX_KEYWORD_LENGTH} characters.`
    case 'too_many_segments':
      return `A keyword may have at most ${MAX_KEYWORD_SEGMENTS} segments.`
    case 'reserved_prefix':
      return 'A keyword must not start with "_": those paths belong to the app.'
    case 'placeholder_character':
      return '"%" may only appear as a whole "%s" segment.'
    case 'pattern_mismatch':
      return `This organization allows keywords matching ${rules.allowedPattern}.`
    case 'canonical_empty_segment':
      return 'Every segment needs at least one letter or digit.'
    case 'placeholder_first_segment':
      return 'The first segment cannot be "%s".'
    case 'placeholder_not_trailing':
      return 'Once a segment is "%s", every segment after it must be "%s" too.'
    case 'placeholder_second_segment_required':
      return 'This organization resolves by prefix, so the second segment must be "%s".'
    default:
      return violation.message
  }
}

export interface KeywordCheckResult {
  /** What to show under the field, or `null` when the keyword is usable. */
  error: string | null
  /** Number of `%s` segments; above zero the link is programmatic. */
  placeholderCount: number
}

/**
 * Runs the organization's keyword rules over what has been typed so far.
 *
 * An empty field is not an error — nothing has been typed yet — so it reports
 * no message and no placeholders.
 */
export function checkKeyword(
  value: string,
  rules: KeywordRules,
  context?: NamespaceContext,
): KeywordCheckResult {
  if (value.trim().length === 0) {
    return { error: null, placeholderCount: 0 }
  }

  const evaluation = evaluateKeyword(value, rules, context)
  if (!evaluation.ok) {
    return {
      error: keywordMessage(evaluation, rules),
      placeholderCount: countPlaceholderSegments(splitKeywordSegments(value.trim().toLowerCase())),
    }
  }

  return { error: null, placeholderCount: evaluation.placeholderCount }
}

/**
 * Checks the destination against spec 03 §3 and against the keyword's
 * placeholder count (spec 03 §2.4).
 *
 * A destination with no scheme is not an error: the API prepends `https://`,
 * and so does the preview below, so `wiki.acme.com/handbook` is accepted here
 * exactly as it is there.
 */
export function checkDestination(
  value: string,
  keywordPlaceholderCount: number,
): { error: string | null } {
  if (value.trim().length === 0) {
    return { error: null }
  }

  const evaluation = evaluateDestination(value)
  if (!evaluation.ok) {
    return { error: evaluation.message }
  }

  const counts = checkPlaceholderCounts(keywordPlaceholderCount, evaluation.placeholderCount)
  return { error: counts.ok ? null : counts.message }
}

/** A value to stand in for `%s` in the preview under a programmatic keyword. */
export const PLACEHOLDER_SAMPLE = 'example'

/**
 * What a programmatic link would redirect to for a sample value (spec 08 §4).
 *
 * Substitution here is deliberately literal rather than percent-encoded: the
 * preview exists to show where the `%s` lands, and `example` is chosen to need
 * no encoding.
 */
export function expandedPreview(destination: string, placeholderCount: number): string | null {
  if (placeholderCount === 0 || destination.trim().length === 0) {
    return null
  }
  if (countDestinationPlaceholders(destination) !== placeholderCount) {
    return null
  }
  return destination.trim().replaceAll('%s', PLACEHOLDER_SAMPLE)
}

/** The sample keyword shown beside the preview, for example `jira/example`. */
export function expandedKeywordPreview(keyword: string): string {
  return keyword.trim().toLowerCase().replaceAll('%s', PLACEHOLDER_SAMPLE)
}

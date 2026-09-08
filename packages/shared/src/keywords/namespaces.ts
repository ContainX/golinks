import { canonicalizeKeywordSegment } from './canonical.ts'
import type { KeywordRules } from './rules.ts'
import { splitKeywordSegments } from './segments.ts'
import { KEYWORD_CHECK_OK, type KeywordCheck, keywordViolation } from './violations.ts'

/**
 * The reserved-prefix rule for the default namespace (spec 03 §2.5).
 *
 * A keyword with two or more segments created in the default namespace must
 * not have a first segment equal to one of the organization's namespaces:
 * `go/eng/deploy` would otherwise mean either the keyword `eng/deploy` in `go`
 * or the keyword `deploy` in `eng`. A single-segment keyword such as `eng` is
 * allowed, because a request for `/eng` has no remainder and therefore always
 * means the default-namespace keyword (spec 04 §4). Keywords created in a
 * named namespace are unaffected.
 *
 * Both sides are compared in canonical form, because that is the form the
 * resolver compares when it detects a namespace (spec 04 §4), and a namespace
 * such as `eng-tools` canonicalizes to `engtools` in a punctuation-insensitive
 * organization.
 *
 * `keyword` may be the display or the canonical keyword; only its first
 * segment is read.
 */
export function checkReservedNamespacePrefix(
  keyword: string,
  namespace: string,
  defaultNamespace: string,
  namespaces: readonly string[],
  rules: KeywordRules,
): KeywordCheck {
  if (namespace.trim().toLowerCase() !== defaultNamespace.trim().toLowerCase()) {
    return KEYWORD_CHECK_OK
  }

  const segments = splitKeywordSegments(keyword)
  if (segments.length < 2) return KEYWORD_CHECK_OK

  const prefix = canonicalizeKeywordSegment(segments[0] ?? '', rules)
  if (prefix.length === 0) return KEYWORD_CHECK_OK

  for (const candidate of namespaces) {
    if (canonicalizeKeywordSegment(candidate, rules) !== prefix) continue
    return keywordViolation(
      'namespace_reserved',
      'namespace_prefix_reserved',
      `"${candidate}" is a namespace of this organization, so it cannot be the first segment of a multi-segment keyword in the default namespace "${defaultNamespace}".`,
    )
  }

  return KEYWORD_CHECK_OK
}

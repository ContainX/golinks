import { canonicalizeKeyword } from './canonical.ts'
import { checkReservedNamespacePrefix } from './namespaces.ts'
import { normalizeKeyword } from './normalization.ts'
import { checkAllowedPattern, checkKeywordInvariants } from './pattern.ts'
import { checkPlaceholderPositions } from './placeholders.ts'
import { DEFAULT_KEYWORD_RULES, type KeywordRules } from './rules.ts'
import { countPlaceholderSegments } from './segments.ts'
import type { KeywordViolation } from './violations.ts'

/** Where the keyword is being created, for the reserved-prefix rule (spec 03 §2.5). */
export interface KeywordNamespaceContext {
  /** The namespace the link is being created in. */
  namespace: string
  /** The organization's default namespace. */
  defaultNamespace: string
  /** The organization's configured namespaces, excluding the default. */
  namespaces: readonly string[]
}

export interface EvaluatedKeyword {
  ok: true
  /** Normalized as entered; what the directory shows (spec 03 §2.1). */
  displayKeyword: string
  /** The form used for lookups, uniqueness, and conflicts (spec 03 §2.2). */
  canonicalKeyword: string
  /** First segment of the canonical keyword; the `keyword_prefix` column. */
  prefix: string
  /** The canonical keyword's segments. */
  segments: string[]
  segmentCount: number
  /** Number of `%s` segments. */
  placeholderCount: number
  /** True when the keyword has at least one placeholder. */
  isProgrammatic: boolean
}

export type KeywordEvaluation = EvaluatedKeyword | KeywordViolation

/**
 * Runs the whole keyword pipeline of spec 03 §2 over one keyword.
 *
 * Order: normalization (§2.1), the invariants that hold whatever the pattern
 * says (§2.3), placeholder positions (§2.4), the organization's allowed pattern
 * (§2.3), the canonical form (§2.2), and finally the reserved namespace prefix
 * (§2.5). Placeholder positions are checked before the allowed pattern so that
 * a misplaced `%s` reports `placeholder_invalid` rather than a pattern mismatch,
 * whatever pattern the organization has configured.
 *
 * `context` is optional: the web app checks keywords as they are typed without
 * knowing the target namespace, and the reserved-prefix rule is then skipped.
 */
export function evaluateKeyword(
  input: string,
  rules: KeywordRules = DEFAULT_KEYWORD_RULES,
  context?: KeywordNamespaceContext,
): KeywordEvaluation {
  const normalized = normalizeKeyword(input)
  if (!normalized.ok) return normalized

  const { displayKeyword, segments: displaySegments } = normalized

  const invariants = checkKeywordInvariants(displaySegments)
  if (!invariants.ok) return invariants

  const placeholders = checkPlaceholderPositions(displaySegments, rules)
  if (!placeholders.ok) return placeholders

  const pattern = checkAllowedPattern(displayKeyword, rules)
  if (!pattern.ok) return pattern

  const canonical = canonicalizeKeyword(displayKeyword, rules)
  if (!canonical.ok) return canonical

  const { canonicalKeyword, segments } = canonical

  if (context !== undefined) {
    const reserved = checkReservedNamespacePrefix(
      canonicalKeyword,
      context.namespace,
      context.defaultNamespace,
      context.namespaces,
      rules,
    )
    if (!reserved.ok) return reserved
  }

  const placeholderCount = countPlaceholderSegments(segments)

  return {
    ok: true,
    displayKeyword,
    canonicalKeyword,
    prefix: segments[0] ?? '',
    segments,
    segmentCount: segments.length,
    placeholderCount,
    isProgrammatic: placeholderCount > 0,
  }
}

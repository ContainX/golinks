/**
 * The failure vocabulary shared by every keyword rule check (spec 03 §2).
 *
 * `code` is the wire error code from spec 05 §4. `reason` names the individual
 * rule that failed so that callers and tests can tell two `keyword_invalid`
 * failures apart without reading the message.
 */
export type KeywordErrorCode =
  | 'keyword_invalid'
  | 'keyword_reserved'
  | 'namespace_reserved'
  | 'placeholder_invalid'

export type KeywordViolationReason =
  // Normalization (spec 03 §2.1)
  | 'empty'
  | 'empty_segment'
  | 'too_long'
  | 'too_many_segments'
  // Invariants that hold whatever the allowed pattern says (spec 03 §2.3)
  | 'reserved_prefix'
  | 'placeholder_character'
  // Allowed pattern (spec 03 §2.3)
  | 'pattern_invalid'
  | 'pattern_mismatch'
  // Canonical form (spec 03 §2.2)
  | 'canonical_empty_segment'
  // Placeholders (spec 03 §2.4)
  | 'placeholder_first_segment'
  | 'placeholder_not_trailing'
  | 'placeholder_second_segment_required'
  // Reserved prefixes (spec 03 §2.5)
  | 'namespace_prefix_reserved'

export interface KeywordViolation {
  ok: false
  code: KeywordErrorCode
  reason: KeywordViolationReason
  message: string
}

export function keywordViolation(
  code: KeywordErrorCode,
  reason: KeywordViolationReason,
  message: string,
): KeywordViolation {
  return { ok: false, code, reason, message }
}

/** The result of a single rule check that produces no value of its own. */
export type KeywordCheck = { ok: true } | KeywordViolation

/** The shared "nothing to report" result. */
export const KEYWORD_CHECK_OK: { ok: true } = Object.freeze({ ok: true })

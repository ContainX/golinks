// Keyword rules: normalization, canonical form, allowed characters,
// placeholders, and reserved prefixes (spec 03 §2), plus the segment helpers
// the resolver needs (spec 04 §5).

export {
  type CanonicalKeyword,
  canonicalizeKeyword,
  canonicalizeKeywordSegment,
  type KeywordCanonicalization,
} from './canonical.ts'
export {
  type EvaluatedKeyword,
  evaluateKeyword,
  type KeywordEvaluation,
  type KeywordNamespaceContext,
} from './evaluation.ts'
export { matchKeywordSegments } from './matching.ts'
export { checkReservedNamespacePrefix } from './namespaces.ts'
export {
  type KeywordNormalization,
  type NormalizedKeyword,
  normalizeKeyword,
} from './normalization.ts'
export {
  checkAllowedPattern,
  checkKeywordInvariants,
  compileAllowedPattern,
  RESERVED_KEYWORD_PREFIX,
} from './pattern.ts'
export { checkPlaceholderPositions } from './placeholders.ts'
export type { KeywordResolutionMode, KeywordRules } from './rules.ts'
export {
  DEFAULT_KEYWORD_PATTERN,
  DEFAULT_KEYWORD_RULES,
  MAX_KEYWORD_LENGTH,
  MAX_KEYWORD_SEGMENTS,
} from './rules.ts'
export {
  countPlaceholderSegments,
  isPlaceholderSegment,
  joinKeywordSegments,
  KEYWORD_PLACEHOLDER,
  KEYWORD_SEGMENT_SEPARATOR,
  splitKeywordSegments,
} from './segments.ts'
export type {
  KeywordCheck,
  KeywordErrorCode,
  KeywordViolation,
  KeywordViolationReason,
} from './violations.ts'

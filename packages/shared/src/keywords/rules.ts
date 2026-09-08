import type { KeywordRules } from '../settings/index.ts'

/**
 * The keyword rules an organization applies (spec 03 §2) are the `keywords`
 * block of the organization settings document, so the type lives with the
 * settings schema and is re-exported here for the rule functions that read it.
 */
export type { KeywordResolutionMode, KeywordRules } from '../settings/index.ts'

/**
 * The default `keywords.allowedPattern` from spec 03 §2.3: segments of
 * lowercase letters, digits, and hyphens, or a `%s` placeholder segment.
 *
 * Kept as a literal so that the keyword rules stay free of the settings
 * schema at runtime; a test asserts it still equals the schema's default.
 */
export const DEFAULT_KEYWORD_PATTERN = '^[a-z0-9-]+(/([a-z0-9-]+|%s))*$'

/** The rules an organization starts with before an admin changes anything. */
export const DEFAULT_KEYWORD_RULES: KeywordRules = Object.freeze({
  allowedPattern: DEFAULT_KEYWORD_PATTERN,
  punctuationSensitive: true,
  resolutionMode: 'standard',
})

/** Maximum length of a display keyword, in characters (spec 03 §2.1). */
export const MAX_KEYWORD_LENGTH = 200

/** Maximum number of segments in a keyword (spec 03 §2.1). */
export const MAX_KEYWORD_SEGMENTS = 10

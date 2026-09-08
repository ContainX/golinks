// Destination rules (spec 03 §3) and the redirect construction they feed
// (spec 04 §7).

export {
  ALLOWED_DESTINATION_SCHEMES,
  applyDefaultDestinationScheme,
  countDestinationPlaceholders,
  DEFAULT_DESTINATION_SCHEME,
  type DestinationErrorCode,
  type DestinationEvaluation,
  type DestinationViolation,
  type DestinationViolationReason,
  evaluateDestination,
  hasExplicitScheme,
  MAX_DESTINATION_LENGTH,
  type ValidatedDestination,
} from './destination.ts'
export {
  checkPlaceholderCounts,
  type PlaceholderCountCheck,
  type PlaceholderCountMismatch,
} from './placeholders.ts'
export {
  type BuiltRedirect,
  buildRedirectLocation,
  type RedirectBuild,
  type RedirectFailure,
  substitutePlaceholders,
} from './redirect.ts'

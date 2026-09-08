export interface PlaceholderCountMismatch {
  ok: false
  code: 'placeholder_count_mismatch'
  message: string
  keywordPlaceholderCount: number
  destinationPlaceholderCount: number
}

export type PlaceholderCountCheck = { ok: true } | PlaceholderCountMismatch

/**
 * The number of placeholder segments in a keyword must equal the number of `%s`
 * occurrences in its destination (spec 03 §2.4). A disagreement is
 * `placeholder_count_mismatch` (spec 05 §4).
 */
export function checkPlaceholderCounts(
  keywordPlaceholderCount: number,
  destinationPlaceholderCount: number,
): PlaceholderCountCheck {
  if (keywordPlaceholderCount === destinationPlaceholderCount) return { ok: true }

  return {
    ok: false,
    code: 'placeholder_count_mismatch',
    message: `The keyword has ${keywordPlaceholderCount} "%s" segment${keywordPlaceholderCount === 1 ? '' : 's'} but the destination has ${destinationPlaceholderCount} "%s" occurrence${destinationPlaceholderCount === 1 ? '' : 's'}.`,
    keywordPlaceholderCount,
    destinationPlaceholderCount,
  }
}

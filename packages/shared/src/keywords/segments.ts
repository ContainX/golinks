/** The separator between keyword segments. */
export const KEYWORD_SEGMENT_SEPARATOR = '/'

/** A segment that captures part of the request path (spec 03 §2.4). */
export const KEYWORD_PLACEHOLDER = '%s'

/** Splits a keyword into its segments. The keyword must already be normalized. */
export function splitKeywordSegments(keyword: string): string[] {
  return keyword.split(KEYWORD_SEGMENT_SEPARATOR)
}

/** Joins segments back into a keyword. */
export function joinKeywordSegments(segments: readonly string[]): string {
  return segments.join(KEYWORD_SEGMENT_SEPARATOR)
}

/** True when the segment is exactly the placeholder `%s`. */
export function isPlaceholderSegment(segment: string): boolean {
  return segment === KEYWORD_PLACEHOLDER
}

/** Number of placeholder segments, which is what makes a keyword programmatic. */
export function countPlaceholderSegments(segments: readonly string[]): number {
  let count = 0
  for (const segment of segments) {
    if (isPlaceholderSegment(segment)) count += 1
  }
  return count
}

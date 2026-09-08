import { describe, expect, it } from 'vitest'
import {
  countPlaceholderSegments,
  isPlaceholderSegment,
  joinKeywordSegments,
  KEYWORD_PLACEHOLDER,
  splitKeywordSegments,
} from './segments.ts'

describe('keyword segments', () => {
  it('splits on the separator', () => {
    expect(splitKeywordSegments('gh/%s/%s')).toEqual(['gh', '%s', '%s'])
    expect(splitKeywordSegments('handbook')).toEqual(['handbook'])
  })

  it('joins segments back into a keyword', () => {
    expect(joinKeywordSegments(['gh', '%s', '%s'])).toBe('gh/%s/%s')
    expect(joinKeywordSegments(['handbook'])).toBe('handbook')
  })

  it('round-trips', () => {
    expect(joinKeywordSegments(splitKeywordSegments('docs/api/%s'))).toBe('docs/api/%s')
  })

  it('recognizes only an exact placeholder segment', () => {
    expect(isPlaceholderSegment(KEYWORD_PLACEHOLDER)).toBe(true)
    expect(isPlaceholderSegment('%s ')).toBe(false)
    expect(isPlaceholderSegment('%si')).toBe(false)
    expect(isPlaceholderSegment('%S')).toBe(false)
    expect(isPlaceholderSegment('s')).toBe(false)
  })

  it('counts placeholder segments', () => {
    expect(countPlaceholderSegments(['handbook'])).toBe(0)
    expect(countPlaceholderSegments(['jira', '%s'])).toBe(1)
    expect(countPlaceholderSegments(['gh', '%s', '%s'])).toBe(2)
  })
})

import { describe, expect, it } from 'vitest'
import { canonicalizeKeyword, canonicalizeKeywordSegment } from './canonical.ts'
import { DEFAULT_KEYWORD_RULES, type KeywordRules } from './rules.ts'

const sensitive = DEFAULT_KEYWORD_RULES
const insensitive: KeywordRules = { ...DEFAULT_KEYWORD_RULES, punctuationSensitive: false }

describe('canonicalizeKeywordSegment', () => {
  it('only lowercases when the organization is punctuation-sensitive', () => {
    expect(canonicalizeKeywordSegment('Meeting-Notes', sensitive)).toBe('meeting-notes')
  })

  it('removes ASCII punctuation when the organization is punctuation-insensitive', () => {
    expect(canonicalizeKeywordSegment('meeting-notes', insensitive)).toBe('meetingnotes')
    expect(canonicalizeKeywordSegment('2026-09', insensitive)).toBe('202609')
    expect(canonicalizeKeywordSegment('MEETING_NOTES', insensitive)).toBe('meetingnotes')
  })

  it('keeps the placeholder intact because % is never removed', () => {
    expect(canonicalizeKeywordSegment('%s', insensitive)).toBe('%s')
  })

  it('removes every ASCII punctuation character except / and %', () => {
    const punctuation = '!"#$&\'()*+,-.:;<=>?@[\\]^_`{|}~'
    expect(canonicalizeKeywordSegment(`a${punctuation}b`, insensitive)).toBe('ab')
  })

  it('leaves non-ASCII characters alone', () => {
    expect(canonicalizeKeywordSegment('café', insensitive)).toBe('café')
    expect(canonicalizeKeywordSegment('日本語', insensitive)).toBe('日本語')
  })
})

describe('canonicalizeKeyword', () => {
  it('returns the display keyword when punctuation is significant', () => {
    expect(canonicalizeKeyword('meeting-notes/2026-09', sensitive)).toMatchObject({
      ok: true,
      canonicalKeyword: 'meeting-notes/2026-09',
      segments: ['meeting-notes', '2026-09'],
    })
  })

  it('strips punctuation from every segment when punctuation is insignificant', () => {
    expect(canonicalizeKeyword('meeting-notes/2026-09', insensitive)).toMatchObject({
      ok: true,
      canonicalKeyword: 'meetingnotes/202609',
      segments: ['meetingnotes', '202609'],
    })
  })

  it('keeps placeholder segments', () => {
    expect(canonicalizeKeyword('g-h/%s/%s', insensitive)).toMatchObject({
      ok: true,
      canonicalKeyword: 'gh/%s/%s',
    })
  })

  it('rejects a keyword whose segment collapses to nothing', () => {
    const result = canonicalizeKeyword('docs/--/api', insensitive)
    expect(result).toMatchObject({
      ok: false,
      code: 'keyword_invalid',
      reason: 'canonical_empty_segment',
    })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/Segment 2/)
  })

  it('cannot produce an empty segment when punctuation is significant', () => {
    expect(canonicalizeKeyword('docs/--/api', sensitive)).toMatchObject({ ok: true })
  })
})

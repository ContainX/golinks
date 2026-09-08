import { describe, expect, it } from 'vitest'
import { checkAllowedPattern, checkKeywordInvariants, compileAllowedPattern } from './pattern.ts'
import { DEFAULT_KEYWORD_RULES, type KeywordRules } from './rules.ts'
import { splitKeywordSegments } from './segments.ts'

function invariants(keyword: string) {
  return checkKeywordInvariants(splitKeywordSegments(keyword))
}

describe('checkKeywordInvariants', () => {
  it('accepts ordinary and programmatic keywords', () => {
    expect(invariants('handbook')).toEqual({ ok: true })
    expect(invariants('jira/%s')).toEqual({ ok: true })
    expect(invariants('gh/%s/%s')).toEqual({ ok: true })
    expect(invariants('meeting-notes/2026-09')).toEqual({ ok: true })
  })

  it('reserves the underscore prefix for the application', () => {
    expect(invariants('_internal')).toMatchObject({
      ok: false,
      code: 'keyword_reserved',
      reason: 'reserved_prefix',
    })
  })

  it('reserves the prefix whatever the rest of the keyword looks like', () => {
    expect(invariants('_/api')).toMatchObject({ code: 'keyword_reserved' })
  })

  it('allows an underscore that is not the first character', () => {
    expect(invariants('meeting_notes')).toEqual({ ok: true })
    expect(invariants('docs/_draft')).toEqual({ ok: true })
  })

  it('allows % only as a whole placeholder segment', () => {
    expect(invariants('jira/%sx')).toMatchObject({
      ok: false,
      code: 'keyword_invalid',
      reason: 'placeholder_character',
    })
    expect(invariants('jira/x%s')).toMatchObject({ reason: 'placeholder_character' })
    expect(invariants('50%')).toMatchObject({ reason: 'placeholder_character' })
    expect(invariants('jira/%')).toMatchObject({ reason: 'placeholder_character' })
  })

  it('requires exactly one separator between segments', () => {
    expect(checkKeywordInvariants(['a', '', 'b'])).toMatchObject({
      ok: false,
      code: 'keyword_invalid',
      reason: 'empty_segment',
    })
    expect(checkKeywordInvariants([])).toMatchObject({ reason: 'empty_segment' })
  })
})

describe('compileAllowedPattern', () => {
  it('compiles a valid pattern', () => {
    expect(compileAllowedPattern('^[a-z]+$')).toBeInstanceOf(RegExp)
  })

  it('returns null instead of throwing on a broken pattern', () => {
    expect(compileAllowedPattern('^[a-z')).toBeNull()
  })
})

describe('checkAllowedPattern', () => {
  it('accepts keywords matching the default pattern', () => {
    for (const keyword of ['handbook', 'meeting-notes', 'docs/api', 'jira/%s', 'gh/%s/%s']) {
      expect(checkAllowedPattern(keyword, DEFAULT_KEYWORD_RULES)).toEqual({ ok: true })
    }
  })

  it('rejects keywords outside the default pattern', () => {
    for (const keyword of ['meeting_notes', 'docs.api', 'a b', 'ünicode']) {
      expect(checkAllowedPattern(keyword, DEFAULT_KEYWORD_RULES)).toMatchObject({
        ok: false,
        code: 'keyword_invalid',
        reason: 'pattern_mismatch',
      })
    }
  })

  it('honours a loosened pattern', () => {
    const loosened: KeywordRules = {
      ...DEFAULT_KEYWORD_RULES,
      allowedPattern: '^[a-z0-9._-]+(/([a-z0-9._-]+|%s))*$',
    }
    expect(checkAllowedPattern('meeting_notes', loosened)).toEqual({ ok: true })
    expect(checkAllowedPattern('docs.api/v1', loosened)).toEqual({ ok: true })
  })

  it('reports a pattern that does not compile rather than throwing', () => {
    const broken: KeywordRules = { ...DEFAULT_KEYWORD_RULES, allowedPattern: '^[a-z' }
    expect(checkAllowedPattern('handbook', broken)).toMatchObject({
      ok: false,
      code: 'keyword_invalid',
      reason: 'pattern_invalid',
    })
  })
})

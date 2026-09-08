import { describe, expect, it } from 'vitest'
import { checkPlaceholderPositions } from './placeholders.ts'
import { DEFAULT_KEYWORD_RULES, type KeywordRules } from './rules.ts'
import { splitKeywordSegments } from './segments.ts'

const prefixFallback: KeywordRules = {
  ...DEFAULT_KEYWORD_RULES,
  resolutionMode: 'prefixFallback',
}

function check(keyword: string, rules: KeywordRules = DEFAULT_KEYWORD_RULES) {
  return checkPlaceholderPositions(splitKeywordSegments(keyword), rules)
}

describe('checkPlaceholderPositions', () => {
  it('accepts the valid shapes from the spec', () => {
    expect(check('jira/%s')).toEqual({ ok: true })
    expect(check('gh/%s/%s')).toEqual({ ok: true })
    expect(check('docs/api/%s')).toEqual({ ok: true })
  })

  it('accepts keywords with no placeholders at all', () => {
    expect(check('handbook')).toEqual({ ok: true })
    expect(check('docs/api/v1')).toEqual({ ok: true })
  })

  it('rejects a placeholder as the first segment', () => {
    expect(check('%s')).toMatchObject({
      ok: false,
      code: 'placeholder_invalid',
      reason: 'placeholder_first_segment',
    })
    expect(check('%s/tail')).toMatchObject({ reason: 'placeholder_first_segment' })
  })

  it('rejects a literal segment after a placeholder', () => {
    expect(check('gh/%s/issues')).toMatchObject({
      ok: false,
      code: 'placeholder_invalid',
      reason: 'placeholder_not_trailing',
    })
    expect(check('a/%s/b/%s')).toMatchObject({ reason: 'placeholder_not_trailing' })
  })

  it('requires the second segment to be a placeholder in prefixFallback mode', () => {
    expect(check('docs/api', prefixFallback)).toMatchObject({
      ok: false,
      code: 'placeholder_invalid',
      reason: 'placeholder_second_segment_required',
    })
  })

  it('allows single-segment and placeholder keywords in prefixFallback mode', () => {
    expect(check('handbook', prefixFallback)).toEqual({ ok: true })
    expect(check('jira/%s', prefixFallback)).toEqual({ ok: true })
    expect(check('gh/%s/%s', prefixFallback)).toEqual({ ok: true })
  })

  it('allows hierarchical keywords in standard mode', () => {
    expect(check('docs/api', DEFAULT_KEYWORD_RULES)).toEqual({ ok: true })
  })

  it('checks placeholder ordering before the prefixFallback rule', () => {
    expect(check('gh/%s/issues', prefixFallback)).toMatchObject({
      reason: 'placeholder_not_trailing',
    })
  })
})

import { describe, expect, it } from 'vitest'
import { matchKeywordSegments } from './matching.ts'
import { DEFAULT_KEYWORD_RULES, type KeywordRules } from './rules.ts'
import { splitKeywordSegments } from './segments.ts'

const insensitive: KeywordRules = { ...DEFAULT_KEYWORD_RULES, punctuationSensitive: false }

function match(path: string, keyword: string, rules: KeywordRules = DEFAULT_KEYWORD_RULES) {
  return matchKeywordSegments(path.split('/'), splitKeywordSegments(keyword), rules)
}

describe('matchKeywordSegments', () => {
  it('captures a single placeholder value', () => {
    expect(match('jira/ACME-123', 'jira/%s')).toEqual(['ACME-123'])
  })

  it('preserves the case and punctuation of captured values', () => {
    expect(match('jira/ACME-123', 'jira/%s')).toEqual(['ACME-123'])
    expect(match('jira/2026-roadmap', 'jira/%s', insensitive)).toEqual(['2026-roadmap'])
  })

  it('captures a raw segment containing a space', () => {
    expect(match('jira/a b', 'jira/%s')).toEqual(['a b'])
  })

  it('captures several placeholders in order', () => {
    expect(match('gh/web/42', 'gh/%s/%s')).toEqual(['web', '42'])
  })

  it('returns null when the segment counts differ', () => {
    expect(match('gh/web', 'gh/%s/%s')).toBeNull()
    expect(match('gh/web/42/extra', 'gh/%s/%s')).toBeNull()
  })

  it('returns null when a literal segment differs', () => {
    expect(match('bitbucket/web/42', 'gh/%s/%s')).toBeNull()
    expect(match('docs/guides/%s', 'docs/api/%s')).toBeNull()
  })

  it('compares literal segments in canonical form', () => {
    expect(match('meeting-notes/2026', 'meetingnotes/%s', insensitive)).toEqual(['2026'])
    expect(match('meeting-notes/2026', 'meetingnotes/%s', DEFAULT_KEYWORD_RULES)).toBeNull()
  })

  it('compares literal segments case-insensitively', () => {
    expect(match('GH/web/42', 'gh/%s/%s')).toEqual(['web', '42'])
  })

  it('matches a keyword with no placeholders and captures nothing', () => {
    expect(match('docs/api', 'docs/api')).toEqual([])
  })

  it('matches a trailing literal segment after a captured one', () => {
    expect(match('docs/api/v1', 'docs/api/%s')).toEqual(['v1'])
  })

  it('handles a single segment', () => {
    expect(match('handbook', 'handbook')).toEqual([])
    expect(match('handbook', 'jira')).toBeNull()
  })

  it('captures an empty request segment as an empty value', () => {
    expect(matchKeywordSegments(['jira', ''], ['jira', '%s'], DEFAULT_KEYWORD_RULES)).toEqual([''])
  })
})

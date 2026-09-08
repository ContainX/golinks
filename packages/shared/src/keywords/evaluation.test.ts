import { describe, expect, it } from 'vitest'
import { type EvaluatedKeyword, evaluateKeyword } from './evaluation.ts'
import { DEFAULT_KEYWORD_RULES, type KeywordRules } from './rules.ts'

const insensitive: KeywordRules = { ...DEFAULT_KEYWORD_RULES, punctuationSensitive: false }
const prefixFallback: KeywordRules = {
  ...DEFAULT_KEYWORD_RULES,
  resolutionMode: 'prefixFallback',
}

const acme = { namespace: 'go', defaultNamespace: 'go', namespaces: ['eng', 'docs'] }

function succeed(...args: Parameters<typeof evaluateKeyword>): EvaluatedKeyword {
  const result = evaluateKeyword(...args)
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`)
  return result
}

function fail(...args: Parameters<typeof evaluateKeyword>) {
  const result = evaluateKeyword(...args)
  if (result.ok) throw new Error('expected failure')
  return result
}

describe('evaluateKeyword', () => {
  it('describes a simple keyword', () => {
    expect(succeed(' /Handbook/ ')).toEqual({
      ok: true,
      displayKeyword: 'handbook',
      canonicalKeyword: 'handbook',
      prefix: 'handbook',
      segments: ['handbook'],
      segmentCount: 1,
      placeholderCount: 0,
      isProgrammatic: false,
    })
  })

  it('describes a hierarchical keyword', () => {
    expect(succeed('docs/api/v1')).toMatchObject({
      canonicalKeyword: 'docs/api/v1',
      prefix: 'docs',
      segmentCount: 3,
      placeholderCount: 0,
      isProgrammatic: false,
    })
  })

  it('describes a programmatic keyword', () => {
    expect(succeed('gh/%s/%s')).toMatchObject({
      displayKeyword: 'gh/%s/%s',
      canonicalKeyword: 'gh/%s/%s',
      prefix: 'gh',
      segments: ['gh', '%s', '%s'],
      segmentCount: 3,
      placeholderCount: 2,
      isProgrammatic: true,
    })
  })

  it('keeps display and canonical apart in a punctuation-insensitive organization', () => {
    expect(succeed('Meeting-Notes/2026-09', insensitive)).toMatchObject({
      displayKeyword: 'meeting-notes/2026-09',
      canonicalKeyword: 'meetingnotes/202609',
      prefix: 'meetingnotes',
      segments: ['meetingnotes', '202609'],
    })
  })

  it('keeps display and canonical equal in a punctuation-sensitive organization', () => {
    const result = succeed('meeting-notes/2026-09')
    expect(result.canonicalKeyword).toBe(result.displayKeyword)
  })

  it('defaults to the default keyword rules', () => {
    expect(succeed('handbook').canonicalKeyword).toBe('handbook')
    expect(fail('meeting_notes')).toMatchObject({ reason: 'pattern_mismatch' })
  })

  it('reports keyword_invalid for normalization failures', () => {
    expect(fail('')).toMatchObject({ code: 'keyword_invalid', reason: 'empty' })
    expect(fail('a//b')).toMatchObject({ code: 'keyword_invalid', reason: 'empty_segment' })
    expect(fail('a'.repeat(201))).toMatchObject({ code: 'keyword_invalid', reason: 'too_long' })
    expect(fail(Array.from({ length: 11 }, () => 'a').join('/'))).toMatchObject({
      code: 'keyword_invalid',
      reason: 'too_many_segments',
    })
  })

  it('reports keyword_reserved for a leading underscore', () => {
    expect(fail('_internal')).toMatchObject({
      code: 'keyword_reserved',
      reason: 'reserved_prefix',
    })
  })

  it('reports keyword_reserved before the allowed pattern', () => {
    const loosened: KeywordRules = { ...DEFAULT_KEYWORD_RULES, allowedPattern: '^[a-z]+$' }
    expect(fail('_internal', loosened)).toMatchObject({ code: 'keyword_reserved' })
  })

  it('reports keyword_invalid for a stray percent sign', () => {
    expect(fail('jira/%sx')).toMatchObject({
      code: 'keyword_invalid',
      reason: 'placeholder_character',
    })
  })

  it('reports placeholder_invalid for placeholder position rules', () => {
    expect(fail('%s')).toMatchObject({
      code: 'placeholder_invalid',
      reason: 'placeholder_first_segment',
    })
    expect(fail('gh/%s/issues')).toMatchObject({
      code: 'placeholder_invalid',
      reason: 'placeholder_not_trailing',
    })
  })

  it('reports placeholder_invalid before a pattern mismatch', () => {
    expect(fail('%s/tail')).toMatchObject({ code: 'placeholder_invalid' })
  })

  it('reports the prefixFallback second-segment rule', () => {
    expect(fail('docs/api', prefixFallback)).toMatchObject({
      code: 'placeholder_invalid',
      reason: 'placeholder_second_segment_required',
    })
    expect(succeed('jira/%s', prefixFallback)).toMatchObject({ placeholderCount: 1 })
  })

  it('reports keyword_invalid for a keyword outside the allowed pattern', () => {
    expect(fail('meeting notes')).toMatchObject({
      code: 'keyword_invalid',
      reason: 'pattern_mismatch',
    })
  })

  it('reports keyword_invalid when a segment disappears in canonical form', () => {
    expect(fail('docs/--/api', insensitive)).toMatchObject({
      code: 'keyword_invalid',
      reason: 'canonical_empty_segment',
    })
  })

  it('reports namespace_reserved when the first segment is a namespace', () => {
    expect(fail('eng/deploy', DEFAULT_KEYWORD_RULES, acme)).toMatchObject({
      code: 'namespace_reserved',
      reason: 'namespace_prefix_reserved',
    })
  })

  it('allows a namespace name as the first segment inside another namespace', () => {
    expect(
      succeed('eng/deploy', DEFAULT_KEYWORD_RULES, { ...acme, namespace: 'docs' }),
    ).toMatchObject({ canonicalKeyword: 'eng/deploy' })
  })

  it('skips the reserved-prefix rule when no namespace context is given', () => {
    expect(succeed('eng/deploy')).toMatchObject({ canonicalKeyword: 'eng/deploy' })
  })

  it('checks the reserved prefix in canonical form', () => {
    expect(fail('e-ng/deploy', insensitive, acme)).toMatchObject({ code: 'namespace_reserved' })
  })

  it('carries a human-readable message on every failure', () => {
    expect(fail('_internal').message).toMatch(/must not start with "_"/)
    expect(fail('%s').message).toMatch(/first segment/)
    expect(fail('eng/deploy', DEFAULT_KEYWORD_RULES, acme).message).toMatch(/namespace/)
  })

  it('accepts the worked examples from the resolution spec', () => {
    for (const keyword of ['handbook', 'jira/%s', 'gh/%s/%s', 'meeting-notes']) {
      expect(succeed(keyword, DEFAULT_KEYWORD_RULES, acme).displayKeyword).toBe(keyword)
    }
    expect(succeed('deploy', DEFAULT_KEYWORD_RULES, { ...acme, namespace: 'eng' })).toMatchObject({
      canonicalKeyword: 'deploy',
    })
  })

  it('accepts a ten-segment keyword and rejects eleven', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `s${index}`).join('/')
    expect(succeed(ten).segmentCount).toBe(10)
    expect(fail(`${ten}/s10`)).toMatchObject({ reason: 'too_many_segments' })
  })
})

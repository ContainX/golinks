import { describe, expect, it } from 'vitest'
import { checkReservedNamespacePrefix } from './namespaces.ts'
import { DEFAULT_KEYWORD_RULES, type KeywordRules } from './rules.ts'

const namespaces = ['eng', 'docs']
const insensitive: KeywordRules = { ...DEFAULT_KEYWORD_RULES, punctuationSensitive: false }

describe('checkReservedNamespacePrefix', () => {
  it('rejects a default-namespace keyword whose first segment is a namespace', () => {
    const result = checkReservedNamespacePrefix(
      'eng/deploy',
      'go',
      'go',
      namespaces,
      DEFAULT_KEYWORD_RULES,
    )
    expect(result).toMatchObject({
      ok: false,
      code: 'namespace_reserved',
      reason: 'namespace_prefix_reserved',
    })
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/"eng"/)
  })

  it('allows a single-segment keyword equal to a namespace', () => {
    // A request for `/eng` has no remainder, so it can only mean the
    // default-namespace keyword; there is nothing to be ambiguous with.
    expect(
      checkReservedNamespacePrefix('eng', 'go', 'go', namespaces, DEFAULT_KEYWORD_RULES),
    ).toEqual({ ok: true })
  })

  it('accepts a keyword whose first segment is not a namespace', () => {
    expect(
      checkReservedNamespacePrefix('handbook', 'go', 'go', namespaces, DEFAULT_KEYWORD_RULES),
    ).toEqual({ ok: true })
    expect(
      checkReservedNamespacePrefix('engineering/x', 'go', 'go', namespaces, DEFAULT_KEYWORD_RULES),
    ).toEqual({ ok: true })
  })

  it('does not apply inside a named namespace', () => {
    expect(
      checkReservedNamespacePrefix('eng/deploy', 'eng', 'go', namespaces, DEFAULT_KEYWORD_RULES),
    ).toEqual({ ok: true })
    expect(
      checkReservedNamespacePrefix('docs/api', 'docs', 'go', namespaces, DEFAULT_KEYWORD_RULES),
    ).toEqual({ ok: true })
  })

  it('accepts anything when the organization has no extra namespaces', () => {
    expect(
      checkReservedNamespacePrefix('eng/deploy', 'go', 'go', [], DEFAULT_KEYWORD_RULES),
    ).toEqual({ ok: true })
  })

  it('compares in canonical form for a punctuation-insensitive organization', () => {
    expect(
      checkReservedNamespacePrefix('engtools/x', 'go', 'go', ['eng-tools'], insensitive),
    ).toMatchObject({ code: 'namespace_reserved' })
    expect(
      checkReservedNamespacePrefix('engtools/x', 'go', 'go', ['eng-tools'], DEFAULT_KEYWORD_RULES),
    ).toEqual({ ok: true })
  })

  it('compares namespaces case-insensitively', () => {
    expect(
      checkReservedNamespacePrefix('eng/deploy', 'GO', 'go', ['ENG'], DEFAULT_KEYWORD_RULES),
    ).toMatchObject({ code: 'namespace_reserved' })
  })
})

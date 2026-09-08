import { DEFAULT_KEYWORD_RULES } from '@golinks/shared/keywords'
import { describe, expect, it } from 'vitest'
import {
  checkDestination,
  checkKeyword,
  expandedKeywordPreview,
  expandedPreview,
} from './validation.ts'

const rules = DEFAULT_KEYWORD_RULES

describe('checking a keyword as it is typed', () => {
  it('says nothing about an empty field', () => {
    expect(checkKeyword('', rules)).toEqual({ error: null, placeholderCount: 0 })
  })

  it('accepts a keyword the allowed pattern permits', () => {
    expect(checkKeyword('meeting-notes/2026', rules).error).toBeNull()
  })

  it('names the allowed pattern rather than repeating the whole violation text', () => {
    const result = checkKeyword('Meeting Notes!', rules)
    expect(result.error).toContain(rules.allowedPattern)
  })

  it('refuses the prefix the application reserves', () => {
    expect(checkKeyword('_internal', rules).error).toMatch(/must not start with "_"/)
  })

  it('explains a placeholder in the wrong place', () => {
    expect(checkKeyword('%s/issues', rules).error).toMatch(/first segment/)
    expect(checkKeyword('gh/%s/issues', rules).error).toMatch(/every segment after it/)
  })

  it('counts the placeholder segments that make a link programmatic', () => {
    expect(checkKeyword('gh/%s/%s', rules).placeholderCount).toBe(2)
    expect(checkKeyword('handbook', rules).placeholderCount).toBe(0)
  })

  it('applies the reserved namespace prefix when a namespace is known', () => {
    const result = checkKeyword('eng/deploy', rules, {
      namespace: 'go',
      defaultNamespace: 'go',
      namespaces: ['eng'],
    })
    expect(result.error).not.toBeNull()
  })
})

describe('checking a destination', () => {
  it('accepts a value with no scheme, which the API completes', () => {
    expect(checkDestination('wiki.acme.com/handbook', 0).error).toBeNull()
  })

  it('refuses a scheme that is not http or https', () => {
    expect(checkDestination('ftp://files.acme.test', 0).error).toMatch(/http or https/)
  })

  it('refuses a value that does not parse as a URL at all', () => {
    expect(checkDestination('javascript:alert(1)', 0).error).toMatch(/not a valid URL/)
  })

  it('reports a placeholder count the keyword disagrees with', () => {
    expect(checkDestination('https://acme.test/browse/%s', 0).error).toMatch(/"%s"/)
    expect(checkDestination('https://acme.test/browse/%s', 1).error).toBeNull()
  })
})

describe('the placeholder preview', () => {
  it('shows where a sample value would land', () => {
    expect(expandedPreview('https://acme.test/browse/%s', 1)).toBe(
      'https://acme.test/browse/example',
    )
    expect(expandedKeywordPreview('jira/%s')).toBe('jira/example')
  })

  it('shows nothing while the counts still disagree', () => {
    expect(expandedPreview('https://acme.test/browse', 1)).toBeNull()
    expect(expandedPreview('https://acme.test/browse/%s', 0)).toBeNull()
  })
})

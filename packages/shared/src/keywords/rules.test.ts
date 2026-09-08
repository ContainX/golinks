import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYWORD_ALLOWED_PATTERN,
  DEFAULT_ORGANIZATION_SETTINGS,
} from '../settings/index.ts'
import { DEFAULT_KEYWORD_PATTERN, DEFAULT_KEYWORD_RULES } from './rules.ts'

describe('DEFAULT_KEYWORD_RULES', () => {
  it('matches the default pattern from the spec', () => {
    expect(DEFAULT_KEYWORD_PATTERN).toBe('^[a-z0-9-]+(/([a-z0-9-]+|%s))*$')
  })

  it('stays in step with the settings schema default', () => {
    expect(DEFAULT_KEYWORD_PATTERN).toBe(DEFAULT_KEYWORD_ALLOWED_PATTERN)
    expect(DEFAULT_KEYWORD_RULES).toEqual(DEFAULT_ORGANIZATION_SETTINGS.keywords)
  })

  it('is punctuation-sensitive and resolves in standard mode', () => {
    expect(DEFAULT_KEYWORD_RULES.punctuationSensitive).toBe(true)
    expect(DEFAULT_KEYWORD_RULES.resolutionMode).toBe('standard')
  })
})

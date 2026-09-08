import { describe, expect, it } from 'vitest'
import { checkPlaceholderCounts } from './placeholders.ts'

describe('checkPlaceholderCounts', () => {
  it('accepts matching counts', () => {
    expect(checkPlaceholderCounts(0, 0)).toEqual({ ok: true })
    expect(checkPlaceholderCounts(1, 1)).toEqual({ ok: true })
    expect(checkPlaceholderCounts(2, 2)).toEqual({ ok: true })
  })

  it('rejects a keyword with more placeholders than the destination', () => {
    expect(checkPlaceholderCounts(2, 1)).toMatchObject({
      ok: false,
      code: 'placeholder_count_mismatch',
      keywordPlaceholderCount: 2,
      destinationPlaceholderCount: 1,
    })
  })

  it('rejects a destination with more placeholders than the keyword', () => {
    expect(checkPlaceholderCounts(0, 1)).toMatchObject({
      ok: false,
      code: 'placeholder_count_mismatch',
    })
  })

  it('describes both counts in the message', () => {
    const result = checkPlaceholderCounts(1, 2)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/1 "%s" segment /)
    expect(result.message).toMatch(/2 "%s" occurrences/)
  })

  it('uses the singular form for one occurrence', () => {
    const result = checkPlaceholderCounts(0, 1)
    if (result.ok) throw new Error('unreachable')
    expect(result.message).toMatch(/1 "%s" occurrence\./)
  })
})

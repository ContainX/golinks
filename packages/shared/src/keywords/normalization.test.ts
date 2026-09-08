import { describe, expect, it } from 'vitest'
import { normalizeKeyword } from './normalization.ts'

function expectFailure(input: string) {
  const result = normalizeKeyword(input)
  if (result.ok) throw new Error(`expected "${input}" to fail normalization`)
  return result
}

describe('normalizeKeyword', () => {
  it('trims surrounding whitespace', () => {
    const result = normalizeKeyword('  handbook  ')
    expect(result).toMatchObject({ ok: true, displayKeyword: 'handbook' })
  })

  it('lowercases the keyword', () => {
    expect(normalizeKeyword('Handbook')).toMatchObject({ ok: true, displayKeyword: 'handbook' })
    expect(normalizeKeyword('MEETING-NOTES/2026')).toMatchObject({
      ok: true,
      displayKeyword: 'meeting-notes/2026',
    })
  })

  it('removes leading and trailing separators', () => {
    expect(normalizeKeyword('/handbook/')).toMatchObject({ ok: true, displayKeyword: 'handbook' })
    expect(normalizeKeyword('///docs/api///')).toMatchObject({
      ok: true,
      displayKeyword: 'docs/api',
    })
  })

  it('returns the segments of the display keyword', () => {
    const result = normalizeKeyword('gh/%s/%s')
    expect(result).toMatchObject({ ok: true, segments: ['gh', '%s', '%s'] })
  })

  it('rejects an empty keyword', () => {
    expect(expectFailure('')).toMatchObject({ code: 'keyword_invalid', reason: 'empty' })
    expect(expectFailure('   ')).toMatchObject({ code: 'keyword_invalid', reason: 'empty' })
    expect(expectFailure('///')).toMatchObject({ code: 'keyword_invalid', reason: 'empty' })
  })

  it('rejects an empty segment', () => {
    expect(expectFailure('a//b')).toMatchObject({
      code: 'keyword_invalid',
      reason: 'empty_segment',
    })
  })

  it('rejects a keyword longer than 200 characters', () => {
    expect(normalizeKeyword('a'.repeat(200))).toMatchObject({ ok: true })
    expect(expectFailure('a'.repeat(201))).toMatchObject({
      code: 'keyword_invalid',
      reason: 'too_long',
    })
  })

  it('measures length after trimming and separator removal', () => {
    expect(normalizeKeyword(`  /${'a'.repeat(200)}/  `)).toMatchObject({ ok: true })
  })

  it('rejects more than ten segments', () => {
    const ten = Array.from({ length: 10 }, (_, index) => `s${index}`).join('/')
    expect(normalizeKeyword(ten)).toMatchObject({ ok: true, segments: expect.any(Array) })

    const eleven = Array.from({ length: 11 }, (_, index) => `s${index}`).join('/')
    expect(expectFailure(eleven)).toMatchObject({
      code: 'keyword_invalid',
      reason: 'too_many_segments',
    })
  })

  it('reports the empty segment before the length', () => {
    expect(expectFailure(`a//${'b'.repeat(300)}`)).toMatchObject({ reason: 'empty_segment' })
  })

  it('carries a human-readable message on every failure', () => {
    expect(expectFailure('').message).toMatch(/must not be empty/)
    expect(expectFailure('a//b').message).toMatch(/empty segment/)
    expect(expectFailure('a'.repeat(201)).message).toMatch(/200 characters/)
  })
})

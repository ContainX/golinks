import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/http.ts'
import { linkFixture } from '../../test/fixtures.ts'
import { linkFieldErrors } from './errorFields.ts'

function refusal(status: number, code: string, extra: Record<string, unknown> = {}) {
  return new ApiError(status, { code, message: `${code} happened.`, ...extra })
}

describe('reading a refusal as field messages', () => {
  it('puts every keyword rule under the keyword', () => {
    for (const code of [
      'keyword_invalid',
      'keyword_reserved',
      'namespace_reserved',
      'placeholder_invalid',
    ]) {
      expect(linkFieldErrors(refusal(400, code)).keyword).toBe(`${code} happened.`)
    }
  })

  it('puts the destination rules under the destination', () => {
    expect(linkFieldErrors(refusal(400, 'destination_invalid')).destination).toBeDefined()
    expect(linkFieldErrors(refusal(400, 'placeholder_count_mismatch')).destination).toBeDefined()
  })

  it('carries the link a keyword collision named', () => {
    const existing = linkFixture()
    const errors = linkFieldErrors(refusal(409, 'keyword_exists', { existingLink: existing }))

    expect(errors.keyword).toBe('keyword_exists happened.')
    expect(errors.existingLink).toEqual(existing)
  })

  it('spreads a validation failure over the fields it names', () => {
    const errors = linkFieldErrors(
      refusal(400, 'validation_failed', {
        details: { fields: { destination: 'Not a URL.', ownerId: 'Unknown member.' } },
      }),
    )

    expect(errors.destination).toBe('Not a URL.')
    expect(errors.owner).toBe('Unknown member.')
  })

  it('reports a permission failure above the form, where no field is to blame', () => {
    expect(linkFieldErrors(refusal(403, 'forbidden')).general).toBe('forbidden happened.')
    expect(linkFieldErrors(refusal(403, 'read_only')).general).toBe('read_only happened.')
  })

  it('turns anything that is not an API refusal into one general message', () => {
    expect(linkFieldErrors(new TypeError('offline')).general).toMatch(/could not be saved/)
    expect(linkFieldErrors(null)).toEqual({})
  })
})

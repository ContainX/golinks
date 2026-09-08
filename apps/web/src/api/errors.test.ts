import { describe, expect, it } from 'vitest'
import { linkFixture } from '../test/fixtures.ts'
import {
  existingLink,
  isApiError,
  isApiErrorCode,
  isApiErrorCodeName,
  KEYWORD_COLLISION_CODES,
  validationFields,
} from './errors.ts'
import { ApiError } from './http.ts'

const collision = new ApiError(409, {
  code: 'keyword_exists',
  message: 'go/handbook already exists.',
  existingLink: linkFixture({ fullPath: 'go/handbook' }),
})

const invalid = new ApiError(400, {
  code: 'validation_failed',
  message: 'The request was not valid.',
  details: { fields: { destination: 'Must be a URL.' } },
})

describe('isApiError', () => {
  it('tells an answered request apart from a broken one', () => {
    expect(isApiError(collision)).toBe(true)
    expect(isApiError(new TypeError('Failed to fetch'))).toBe(false)
    expect(isApiError('keyword_exists')).toBe(false)
    expect(isApiError(null)).toBe(false)
  })
})

describe('isApiErrorCode', () => {
  it('matches one code', () => {
    expect(isApiErrorCode(collision, 'keyword_exists')).toBe(true)
    expect(isApiErrorCode(collision, 'not_found')).toBe(false)
  })

  it('matches any of several codes', () => {
    expect(isApiErrorCode(collision, KEYWORD_COLLISION_CODES)).toBe(true)
    expect(isApiErrorCode(invalid, KEYWORD_COLLISION_CODES)).toBe(false)
  })

  it('is false for anything that is not an answered request', () => {
    expect(isApiErrorCode(new Error('offline'), 'internal_error')).toBe(false)
    expect(isApiErrorCode(undefined, 'not_found')).toBe(false)
  })

  it('narrows the caught value to an ApiError', () => {
    const error: unknown = collision
    if (isApiErrorCode(error, 'keyword_exists')) {
      expect(error.status).toBe(409)
      expect(error.requestId).toBeNull()
    }
  })
})

describe('isApiErrorCodeName', () => {
  it('recognizes the catalog of spec 05 §4', () => {
    expect(isApiErrorCodeName('keyword_conflict')).toBe(true)
    expect(isApiErrorCodeName('unexpected_response')).toBe(false)
  })
})

describe('existingLink', () => {
  it('hands back the link a keyword collided with (spec 08 §4)', () => {
    expect(existingLink(collision)?.fullPath).toBe('go/handbook')
  })

  it('is null for a failure that names no link', () => {
    expect(existingLink(invalid)).toBeNull()
    expect(existingLink(new Error('offline'))).toBeNull()
  })
})

describe('validationFields', () => {
  it('reads the field messages of a validation failure', () => {
    expect(validationFields(invalid)).toEqual({ destination: 'Must be a URL.' })
  })

  it('is null when the failure carries no usable field messages', () => {
    expect(validationFields(collision)).toBeNull()
    expect(
      validationFields(
        new ApiError(400, { code: 'validation_failed', message: 'No details.', details: {} }),
      ),
    ).toBeNull()
  })
})

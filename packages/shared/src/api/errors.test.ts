import { describe, expect, it } from 'vitest'
import type { ApiErrorCode } from './errors.ts'
import {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  ApiErrorBodySchema,
  ApiErrorCodeSchema,
  createApiErrorBody,
  httpStatusForApiErrorCode,
  ValidationErrorDetailsSchema,
} from './errors.ts'
import { LinkSchema } from './links.ts'

/** Spec 05 section 4, transcribed from the table. */
const SPEC_TABLE: ReadonlyArray<readonly [number, ApiErrorCode]> = [
  [400, 'validation_failed'],
  [400, 'keyword_invalid'],
  [400, 'keyword_reserved'],
  [400, 'namespace_invalid'],
  [400, 'namespace_reserved'],
  [400, 'placeholder_invalid'],
  [400, 'placeholder_count_mismatch'],
  [400, 'destination_invalid'],
  [400, 'owner_invalid'],
  [400, 'cannot_modify_self'],
  [401, 'unauthenticated'],
  [403, 'forbidden'],
  [403, 'read_only'],
  [403, 'csrf_origin_mismatch'],
  [404, 'not_found'],
  [409, 'keyword_exists'],
  [409, 'keyword_conflict'],
  [409, 'namespace_conflicts'],
  [410, 'transfer_expired'],
  [409, 'transfer_owner_changed'],
  [409, 'transfer_creator_lost_access'],
  [409, 'transfer_already_owner'],
  [404, 'transfer_invalid'],
  [415, 'unsupported_media_type'],
  [429, 'rate_limited'],
  [500, 'internal_error'],
]

const exampleLink = {
  id: '42',
  namespace: 'go',
  keyword: 'handbook',
  displayKeyword: 'handbook',
  fullPath: 'go/handbook',
  destination: 'https://docs.acme.com/handbook',
  isProgrammatic: false,
  placeholderCount: 0,
  isUnlisted: false,
  owner: { id: '7', email: 'jane@acme.com' },
  visitCount: 3,
  lastVisitedAt: null,
  createdAt: '2026-01-10T09:00:00Z',
  updatedAt: '2026-08-30T16:20:00Z',
  permissions: { canEditDestination: true, canEdit: true, canDelete: true, canTransfer: true },
}

describe('the error catalog', () => {
  it.each(SPEC_TABLE)('answers %s for %s', (status, code) => {
    expect(httpStatusForApiErrorCode(code)).toBe(status)
  })

  it('covers every code in the spec table', () => {
    for (const [, code] of SPEC_TABLE) {
      expect(API_ERROR_CODES).toContain(code)
    }
  })

  it('adds namespace_in_use for the settings case in spec 06', () => {
    expect(API_ERROR_STATUS.namespace_in_use).toBe(409)
  })

  it('lists every mapped code, and nothing else', () => {
    expect([...API_ERROR_CODES].sort()).toEqual(Object.keys(API_ERROR_STATUS).sort())
  })

  it('validates codes through the schema', () => {
    expect(ApiErrorCodeSchema.parse('keyword_exists')).toBe('keyword_exists')
    expect(ApiErrorCodeSchema.safeParse('kaboom').success).toBe(false)
  })
})

describe('ApiErrorBodySchema', () => {
  it('parses the envelope from the spec', () => {
    const body = ApiErrorBodySchema.parse({
      error: {
        code: 'keyword_exists',
        message: 'go/handbook already exists.',
        details: {},
        existingLink: exampleLink,
      },
    })
    expect(body.error.code).toBe('keyword_exists')
    expect(LinkSchema.parse(body.error.existingLink)).toEqual(exampleLink)
  })

  it('accepts a bare code and message', () => {
    expect(
      ApiErrorBodySchema.parse({ error: { code: 'not_found', message: 'No such link.' } }),
    ).toEqual({ error: { code: 'not_found', message: 'No such link.' } })
  })

  it('rejects an unknown code and an empty message', () => {
    expect(ApiErrorBodySchema.safeParse({ error: { code: 'nope', message: 'x' } }).success).toBe(
      false,
    )
    expect(
      ApiErrorBodySchema.safeParse({ error: { code: 'not_found', message: '' } }).success,
    ).toBe(false)
  })
})

describe('ValidationErrorDetailsSchema', () => {
  it('carries one message per field', () => {
    expect(
      ValidationErrorDetailsSchema.parse({ fields: { destination: 'Must be an http(s) URL.' } }),
    ).toEqual({ fields: { destination: 'Must be an http(s) URL.' } })
  })
})

describe('createApiErrorBody', () => {
  it('omits the optional members when they are not supplied', () => {
    expect(createApiErrorBody('read_only', 'The organization is read-only.')).toEqual({
      error: { code: 'read_only', message: 'The organization is read-only.' },
    })
  })

  it('attaches details and the conflicting link', () => {
    const body = createApiErrorBody('keyword_conflict', 'go/jira/abc matches go/jira/%s.', {
      details: { fields: { keyword: 'Conflicts with a programmatic link.' } },
      existingLink: exampleLink,
    })
    expect(ApiErrorBodySchema.parse(body)).toEqual(body)
  })
})

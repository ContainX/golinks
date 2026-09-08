import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ApiIdSchema,
  BooleanQuerySchema,
  DEFAULT_LIST_LIMIT,
  ListLimitSchema,
  listEnvelopeSchema,
  MAX_LIST_LIMIT,
  TimestampSchema,
} from './common.ts'

describe('ApiIdSchema', () => {
  it('accepts numeric row ids and domain-shaped organization ids alike', () => {
    expect(ApiIdSchema.parse('42')).toBe('42')
    expect(ApiIdSchema.parse('acme.com')).toBe('acme.com')
  })

  it('rejects an empty id', () => {
    expect(ApiIdSchema.safeParse('').success).toBe(false)
  })
})

describe('TimestampSchema', () => {
  it('accepts ISO 8601 UTC strings', () => {
    expect(TimestampSchema.parse('2026-09-07T14:03:00Z')).toBe('2026-09-07T14:03:00Z')
    expect(TimestampSchema.parse('2026-09-07T14:03:00.123Z')).toBe('2026-09-07T14:03:00.123Z')
  })

  it.each(['2026-09-07T14:03:00+02:00', '2026-09-07', 'yesterday'])('rejects %s', (value) => {
    expect(TimestampSchema.safeParse(value).success).toBe(false)
  })
})

describe('ListLimitSchema', () => {
  it('defaults to 50 when omitted', () => {
    expect(ListLimitSchema.parse(undefined)).toBe(DEFAULT_LIST_LIMIT)
  })

  it('accepts a limit sent as a query-string number', () => {
    expect(ListLimitSchema.parse('25')).toBe(25)
  })

  it('rejects a limit above the maximum', () => {
    expect(ListLimitSchema.safeParse(String(MAX_LIST_LIMIT + 1)).success).toBe(false)
    expect(ListLimitSchema.parse(String(MAX_LIST_LIMIT))).toBe(MAX_LIST_LIMIT)
  })

  it.each(['0', '-1', '1.5', 'many'])('rejects %s', (value) => {
    expect(ListLimitSchema.safeParse(value).success).toBe(false)
  })
})

describe('BooleanQuerySchema', () => {
  it('reads the literal words true and false', () => {
    expect(BooleanQuerySchema.parse('true')).toBe(true)
    expect(BooleanQuerySchema.parse('false')).toBe(false)
  })

  it.each(['1', 'yes', 'TRUE', ''])('rejects %s', (value) => {
    expect(BooleanQuerySchema.safeParse(value).success).toBe(false)
  })
})

describe('listEnvelopeSchema', () => {
  const envelope = listEnvelopeSchema(z.object({ id: ApiIdSchema }))

  it('wraps items alongside a nullable cursor', () => {
    expect(envelope.parse({ items: [{ id: '1' }], nextCursor: null })).toEqual({
      items: [{ id: '1' }],
      nextCursor: null,
    })
    expect(envelope.parse({ items: [], nextCursor: 'eyJ2IjoxfQ' }).nextCursor).toBe('eyJ2IjoxfQ')
  })

  it('requires nextCursor to be present', () => {
    expect(envelope.safeParse({ items: [] }).success).toBe(false)
  })
})

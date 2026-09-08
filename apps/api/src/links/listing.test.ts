// The parts of the directory query that hold no database: the cursor codec and the search
// pattern (spec 03 §10.1).

import { describe, expect, it } from 'vitest'
import { ApiError } from '../errors.ts'
import { containsPattern, decodeLinkCursor, encodeLinkCursor } from './listing.ts'

/** The `ApiError` a call threw, so a test can read the code it reported. */
function refusal(work: () => unknown): ApiError {
  try {
    work()
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('Expected the cursor to be refused.')
}

describe('the cursor', () => {
  it('carries the sort value and the id through a round trip', () => {
    const cursor = encodeLinkCursor('visits', 'desc', '128', 42)

    expect(decodeLinkCursor('visits', 'desc', cursor)).toEqual({
      version: 1,
      sort: 'visits',
      order: 'desc',
      value: '128',
      id: 42,
    })
  })

  it('survives a query string without being escaped', () => {
    const cursor = encodeLinkCursor('created', 'asc', '2026-09-07 14:03:00.123456+00', 7)

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeLinkCursor('created', 'asc', cursor).value).toBe('2026-09-07 14:03:00.123456+00')
  })

  it('says nothing about the row it points at', () => {
    const cursor = encodeLinkCursor('keyword', 'asc', 'handbook', 3)

    expect(cursor).not.toContain('handbook')
  })

  it.each([
    ['is not base64url at all', 'not a cursor'],
    ['decodes to something that is not an object', Buffer.from('7').toString('base64url')],
    [
      'is missing the id',
      Buffer.from(
        JSON.stringify({ version: 1, sort: 'visits', order: 'desc', value: '1' }),
      ).toString('base64url'),
    ],
    [
      'was minted under another version',
      Buffer.from(
        JSON.stringify({ version: 99, sort: 'visits', order: 'desc', value: '1', id: 1 }),
      ).toString('base64url'),
    ],
  ])('refuses a cursor that %s', (_case, cursor) => {
    expect(refusal(() => decodeLinkCursor('visits', 'desc', cursor)).code).toBe('validation_failed')
  })

  it('refuses a cursor from a page that was sorted differently', () => {
    const cursor = encodeLinkCursor('keyword', 'asc', 'handbook', 3)

    expect(refusal(() => decodeLinkCursor('created', 'asc', cursor)).code).toBe('validation_failed')
    expect(refusal(() => decodeLinkCursor('keyword', 'desc', cursor)).code).toBe(
      'validation_failed',
    )
  })
})

describe('the search pattern', () => {
  it('matches anywhere in the value', () => {
    expect(containsPattern('wiki')).toBe('%wiki%')
  })

  it('takes the wildcards of the pattern language literally', () => {
    expect(containsPattern('100%_off')).toBe('%100\\%\\_off%')
    expect(containsPattern('back\\slash')).toBe('%back\\\\slash%')
  })
})

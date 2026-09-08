import { describe, expect, it } from 'vitest'
import { decodeListCursor, encodeListCursor } from './cursor.ts'

describe('list cursors', () => {
  it('round-trips the parts of a sort key', () => {
    const cursor = encodeListCursor(['2026-09-07T14:03:00.000Z', '42'])
    expect(decodeListCursor(cursor, 2)).toEqual(['2026-09-07T14:03:00.000Z', '42'])
  })

  it('carries a value that is safe in a query string', () => {
    expect(encodeListCursor(['ada@widgets.test'])).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('refuses a cursor with the wrong number of parts', () => {
    expect(decodeListCursor(encodeListCursor(['42']), 2)).toBeUndefined()
  })

  it('refuses something that was never a cursor', () => {
    expect(decodeListCursor('not-a-cursor', 1)).toBeUndefined()
    expect(decodeListCursor(Buffer.from('{"a":1}').toString('base64url'), 1)).toBeUndefined()
  })

  it('refuses an empty part, which no sort key ever has', () => {
    expect(decodeListCursor(encodeListCursor(['']), 1)).toBeUndefined()
  })
})

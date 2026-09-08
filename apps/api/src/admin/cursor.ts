// The opaque list cursor the admin collections hand back (spec 05 §1).
//
// A cursor is the sort key of the last row on the page, so the next page is a comparison
// against the index rather than an offset the database has to count past. It is opaque on
// purpose: clients round-trip what they were given and nothing else, which leaves the sort key
// free to change without breaking them.

/** Encodes the sort key of the last row on a page. */
export function encodeListCursor(parts: readonly string[]): string {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url')
}

/**
 * Reads a cursor back, or undefined when it did not come from `encodeListCursor` with the same
 * number of parts. A caller answers `validation_failed` rather than letting a typed URL become
 * a 500.
 */
export function decodeListCursor(cursor: string, parts: number): string[] | undefined {
  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }

  if (!Array.isArray(decoded) || decoded.length !== parts) return undefined
  if (!decoded.every((value) => typeof value === 'string' && value.length > 0)) return undefined
  return decoded as string[]
}

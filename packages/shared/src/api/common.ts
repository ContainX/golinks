import { z } from 'zod'

/**
 * Conventions shared by every API shape (spec 05 section 1).
 *
 * Ids are strings in JSON, timestamps are ISO 8601 UTC strings, and lists are returned as
 * `{ items, nextCursor }`.
 */

/** Base path every endpoint in spec 05 hangs off. */
export const API_BASE_PATH = '/_/api/v1'

/** An identifier as it travels in JSON. Numeric row ids and organization ids are both strings. */
export const ApiIdSchema = z.string().trim().min(1, 'An id is required.').max(255)
export type ApiId = z.infer<typeof ApiIdSchema>

/** An ISO 8601 UTC timestamp, for example `2026-09-07T14:03:00Z`. */
export const TimestampSchema = z.iso.datetime()
export type Timestamp = z.infer<typeof TimestampSchema>

/** An email address as the API returns it: trimmed and lowercased. */
export const EmailSchema = z.email()
export type Email = z.infer<typeof EmailSchema>

/** An opaque pagination cursor handed back by the previous page. */
export const CursorSchema = z.string().min(1).max(1024)

/** Page size when a request does not ask for one (spec 03 section 10.1). */
export const DEFAULT_LIST_LIMIT = 50

/** Largest page a request may ask for (spec 03 section 10.1). */
export const MAX_LIST_LIMIT = 200

/** `limit` as it arrives on a query string: a numeric string, defaulted and capped. */
export const ListLimitSchema = z.coerce
  .number()
  .int('limit must be a whole number.')
  .min(1, 'limit must be at least 1.')
  .max(MAX_LIST_LIMIT, `limit must be at most ${MAX_LIST_LIMIT}.`)
  .default(DEFAULT_LIST_LIMIT)

/** A boolean as it arrives on a query string: the literal text `true` or `false`. */
export const BooleanQuerySchema = z
  .enum(['true', 'false'], 'Must be "true" or "false".')
  .transform((value) => value === 'true')

/** Ascending or descending, for endpoints that expose a sort order. */
export const SortOrderSchema = z.enum(['asc', 'desc'])
export type SortOrder = z.infer<typeof SortOrderSchema>

/**
 * Wrap an item schema in the list envelope every collection endpoint returns.
 * `nextCursor` is null on the last page.
 */
export function listEnvelopeSchema<ItemSchema extends z.ZodType>(item: ItemSchema) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  })
}

/** The list envelope as a plain type, for annotating client and handler signatures. */
export interface ListEnvelope<Item> {
  items: Item[]
  nextCursor: string | null
}

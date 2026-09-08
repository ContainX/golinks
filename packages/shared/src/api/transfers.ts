import { z } from 'zod'
import { ApiIdSchema, TimestampSchema } from './common.ts'
import { LinkSummarySchema } from './links.ts'

/** Ownership transfer shapes (spec 05 section 2.4, spec 03 section 9.2). */

/** `POST /links/:id/transfers` response: the one-time acceptance URL. */
export const TransferSchema = z.object({
  id: ApiIdSchema,
  /** `<BASE_URL>/_/transfer/<token>`. The token itself is never stored. */
  url: z.url(),
  expiresAt: TimestampSchema,
})
export type Transfer = z.infer<typeof TransferSchema>

/** Where a transfer stands when the acceptance page asks about it. */
export const TransferStatusSchema = z.enum(['pending', 'expired', 'accepted', 'revoked', 'invalid'])
export type TransferStatus = z.infer<typeof TransferStatusSchema>

/** `GET /transfers/:token` response, shown on the acceptance page before anything mutates. */
export const TransferPreviewSchema = z.object({
  status: TransferStatusSchema,
  link: LinkSummarySchema,
  expiresAt: TimestampSchema,
})
export type TransferPreview = z.infer<typeof TransferPreviewSchema>

/**
 * `:token` on the transfer routes.
 *
 * Deliberately permissive: an unrecognizable token is a 404 `transfer_invalid` from the lookup,
 * not a schema failure, so that guesses cannot be told apart from expired tokens.
 */
export const TransferTokenParamsSchema = z.strictObject({
  token: z.string().min(1, 'A transfer token is required.').max(256),
})
export type TransferTokenParams = z.infer<typeof TransferTokenParamsSchema>

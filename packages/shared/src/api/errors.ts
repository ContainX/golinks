import { z } from 'zod'
import { LinkSchema } from './links.ts'

/** The error envelope and the error catalog (spec 05 section 4). */

/**
 * Every error code the API can return, mapped to the HTTP status it is sent with.
 *
 * The first block is spec 05 section 4 in table order. `namespace_in_use` closes the settings
 * case in spec 06 section 2, which spec 05 does not tabulate.
 */
export const API_ERROR_STATUS = {
  validation_failed: 400,
  keyword_invalid: 400,
  keyword_reserved: 400,
  namespace_invalid: 400,
  namespace_reserved: 400,
  placeholder_invalid: 400,
  placeholder_count_mismatch: 400,
  destination_invalid: 400,
  owner_invalid: 400,
  cannot_modify_self: 400,
  unauthenticated: 401,
  forbidden: 403,
  read_only: 403,
  csrf_origin_mismatch: 403,
  not_found: 404,
  method_not_allowed: 405,
  keyword_exists: 409,
  keyword_conflict: 409,
  namespace_conflicts: 409,
  transfer_expired: 410,
  transfer_owner_changed: 409,
  transfer_creator_lost_access: 409,
  transfer_already_owner: 409,
  transfer_invalid: 404,
  unsupported_media_type: 415,
  rate_limited: 429,
  payload_too_large: 413,
  internal_error: 500,

  /** Spec 06 section 2: a namespace still holding links cannot be removed. */
  namespace_in_use: 409,
} as const

/** Every error code the API can return. */
export type ApiErrorCode = keyof typeof API_ERROR_STATUS

/** The HTTP status carried by a given code. */
export type ApiErrorStatus = (typeof API_ERROR_STATUS)[ApiErrorCode]

/** The catalog as a list, for iteration and for generating documentation. */
export const API_ERROR_CODES = Object.keys(API_ERROR_STATUS) as [ApiErrorCode, ...ApiErrorCode[]]

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES)

/** The status an error code is answered with. */
export function httpStatusForApiErrorCode(code: ApiErrorCode): ApiErrorStatus {
  return API_ERROR_STATUS[code]
}

/** `details` of a `validation_failed`: one message per offending field. */
export const ValidationErrorDetailsSchema = z.object({
  fields: z.record(z.string(), z.string()),
})
export type ValidationErrorDetails = z.infer<typeof ValidationErrorDetailsSchema>

/**
 * The body of every failed request.
 *
 * `existingLink` is present only for `keyword_exists` and `keyword_conflict`; `details` carries
 * field messages for `validation_failed` and the request id for `internal_error`.
 */
export const ApiErrorBodySchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional(),
    existingLink: LinkSchema.optional(),
  }),
})
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>

/** The error object on its own, for handlers that assemble the envelope themselves. */
export type ApiError = ApiErrorBody['error']

/** Build a well-formed error body. */
export function createApiErrorBody(
  code: ApiErrorCode,
  message: string,
  extra: { details?: Record<string, unknown>; existingLink?: z.infer<typeof LinkSchema> } = {},
): ApiErrorBody {
  const error: ApiError = { code, message }
  if (extra.details !== undefined) error.details = extra.details
  if (extra.existingLink !== undefined) error.existingLink = extra.existingLink
  return { error }
}

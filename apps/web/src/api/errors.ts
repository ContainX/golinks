/**
 * Reading a failed request.
 *
 * The transport raises every refusal as an {@link ApiError} carrying the code
 * from the envelope (spec 05 §4). These helpers are how the rest of the app
 * asks what that code was, without every call site repeating an `instanceof`
 * and a string comparison the type system cannot check.
 */

import type { ApiErrorCode, Link, ValidationErrorDetails } from '@golinks/shared/api'
import { API_ERROR_STATUS, ValidationErrorDetailsSchema } from '@golinks/shared/api'
import { ApiError } from './http.ts'

/** Whether the failure came from the API rather than from the network or a bug. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** Whether `value` is one of the codes the API is documented to return. */
export function isApiErrorCodeName(value: string): value is ApiErrorCode {
  return Object.hasOwn(API_ERROR_STATUS, value)
}

/**
 * Whether a caught value is an API failure with a given code.
 *
 * ```ts
 * if (isApiErrorCode(error, 'keyword_exists')) { ... }
 * if (isApiErrorCode(error, KEYWORD_COLLISION_CODES)) { ... }
 * ```
 */
export function isApiErrorCode(
  error: unknown,
  code: ApiErrorCode | readonly ApiErrorCode[],
): error is ApiError {
  if (!isApiError(error)) {
    return false
  }
  return Array.isArray(code)
    ? (code as readonly string[]).includes(error.code)
    : error.code === code
}

/**
 * The two codes that report a keyword the organization already uses (spec 05
 * §4). Both carry the link they collided with, which spec 08 §4 asks the app to
 * show instead of only an error.
 */
export const KEYWORD_COLLISION_CODES = ['keyword_exists', 'keyword_conflict'] as const

/** The link a keyword collision named, or `null` for any other failure. */
export function existingLink(error: unknown): Link | null {
  return isApiErrorCode(error, KEYWORD_COLLISION_CODES) ? error.existingLink : null
}

/**
 * Field-level messages from a `validation_failed`, keyed by field name
 * (spec 05 §4), or `null` when the failure was something else or carried no
 * usable `details`.
 */
export function validationFields(error: unknown): ValidationErrorDetails['fields'] | null {
  if (!isApiErrorCode(error, 'validation_failed')) {
    return null
  }
  const details = ValidationErrorDetailsSchema.safeParse(error.details)
  return details.success ? details.data.fields : null
}

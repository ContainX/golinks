// The error envelope of spec 05 §4 and the exception domain code throws to produce it.
// The code catalog and its statuses live in the shared package so the web app and the
// service agree code for code; this module is the Fastify-facing adapter.

import { API_ERROR_STATUS, type ApiErrorCode } from '@golinks/shared/api'

/** Every code spec 05 §4 defines, with the status it is answered with. */
export const ERROR_STATUS = API_ERROR_STATUS

export type { ApiErrorCode }

/** The `existingLink` field is only ever set for keyword_exists and keyword_conflict. */
export interface ErrorBody {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
  existingLink?: unknown
}

export interface ErrorEnvelope {
  error: ErrorBody
}

export interface ApiErrorOptions {
  /** Overrides the status ERROR_STATUS assigns to the code. */
  status?: number
  details?: Record<string, unknown>
  existingLink?: unknown
  cause?: unknown
}

/** Thrown by domain code; the error handler turns it straight into the envelope. */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: Record<string, unknown> | undefined
  readonly existingLink: unknown

  constructor(code: ApiErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ApiError'
    this.code = code
    this.status = options.status ?? ERROR_STATUS[code]
    this.details = options.details
    this.existingLink = options.existingLink
  }

  toEnvelope(): ErrorEnvelope {
    return errorEnvelope(this.code, this.message, {
      details: this.details,
      existingLink: this.existingLink,
    })
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError
}

/** Builds the envelope, leaving out the optional members that carry nothing. */
export function errorEnvelope(
  code: ApiErrorCode,
  message: string,
  extra: { details?: Record<string, unknown> | undefined; existingLink?: unknown } = {},
): ErrorEnvelope {
  const body: ErrorBody = { code, message }
  if (extra.details !== undefined && Object.keys(extra.details).length > 0) {
    body.details = extra.details
  }
  if (extra.existingLink !== undefined) body.existingLink = extra.existingLink
  return { error: body }
}

// --- shorthand constructors used across the service -------------------------

export function notFound(message = 'The requested resource does not exist.'): ApiError {
  return new ApiError('not_found', message)
}

export function methodNotAllowed(allowed: readonly string[]): ApiError {
  return new ApiError('method_not_allowed', `Only ${allowed.join(', ')} are accepted here.`, {
    details: { allowed: [...allowed] },
  })
}

export function validationFailed(fields: Record<string, string>): ApiError {
  return new ApiError('validation_failed', 'The request body or query is not valid.', {
    details: { fields },
  })
}

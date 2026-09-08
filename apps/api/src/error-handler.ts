// Turns everything thrown inside the service into the error envelope of spec 05 §4.

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod'
import { ApiError, type ApiErrorCode, type ErrorEnvelope, errorEnvelope } from './errors.ts'

/** Fastify's own errors, mapped onto the catalog. */
const FASTIFY_CODES: Record<string, ApiErrorCode> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: 'unsupported_media_type',
  FST_ERR_CTP_EMPTY_TYPE: 'unsupported_media_type',
  FST_ERR_CTP_BODY_TOO_LARGE: 'payload_too_large',
  FST_ERR_CTP_INVALID_JSON_BODY: 'validation_failed',
  FST_ERR_CTP_EMPTY_JSON_BODY: 'validation_failed',
  FST_ERR_VALIDATION: 'validation_failed',
  FST_ERR_NOT_FOUND: 'not_found',
}

const STATUS_CODES: Record<number, ApiErrorCode> = {
  400: 'validation_failed',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
}

/** `/keyword` becomes `keyword`, `/banner/text` becomes `banner.text`, root becomes `body`. */
function fieldNameOf(instancePath: string): string {
  const trimmed = instancePath.replace(/^\//, '')
  return trimmed.length === 0 ? 'body' : trimmed.split('/').join('.')
}

function validationDetails(error: FastifyError): Record<string, unknown> {
  const fields: Record<string, string> = {}
  for (const issue of error.validation ?? []) {
    const name = fieldNameOf(issue.instancePath ?? '')
    if (fields[name] === undefined) fields[name] = issue.message ?? 'is not valid'
  }
  return { fields }
}

function statusOf(error: FastifyError): number {
  const status = error.statusCode
  return typeof status === 'number' && status >= 400 && status <= 599 ? status : 500
}

export interface RenderedError {
  status: number
  envelope: ErrorEnvelope
}

/** Chooses the status and envelope for a thrown value. Pure, so it is easy to test. */
export function renderError(error: FastifyError, requestId: string): RenderedError {
  if (error instanceof ApiError) {
    return { status: error.status, envelope: error.toEnvelope() }
  }

  if (hasZodFastifySchemaValidationErrors(error)) {
    return {
      status: 400,
      envelope: errorEnvelope('validation_failed', 'The request is not valid.', {
        details: validationDetails(error as unknown as FastifyError),
      }),
    }
  }

  // A response that does not match its own schema is a bug in the service, not in the request.
  if (isResponseSerializationError(error)) {
    return {
      status: 500,
      envelope: errorEnvelope('internal_error', 'Something went wrong on our side.', {
        details: { requestId },
      }),
    }
  }

  const status = statusOf(error)
  const code =
    (error.code === undefined ? undefined : FASTIFY_CODES[error.code]) ?? STATUS_CODES[status]

  if (code === undefined || status >= 500) {
    return {
      status: 500,
      envelope: errorEnvelope('internal_error', 'Something went wrong on our side.', {
        details: { requestId },
      }),
    }
  }

  const details =
    code === 'validation_failed' && error.validation ? validationDetails(error) : undefined
  return { status, envelope: errorEnvelope(code, error.message, { details }) }
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const rendered = renderError(error, request.id)

    if (rendered.status >= 500) {
      request.log.error({ err: error }, 'request failed')
    } else {
      request.log.info(
        { err: error.message, code: rendered.envelope.error.code },
        'request rejected',
      )
    }

    return reply.code(rendered.status).send(rendered.envelope)
  })

  // Reached only for methods the catch-all route does not declare; everything else is routed.
  app.setNotFoundHandler((_request: FastifyRequest, reply: FastifyReply) => {
    return reply
      .code(404)
      .send(errorEnvelope('not_found', 'The requested resource does not exist.'))
  })
}

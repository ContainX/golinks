/**
 * Putting an API refusal next to the field that caused it.
 *
 * The API answers with one code and one message (spec 05 §4). Which field that
 * belongs to is not in the envelope, but it follows from the code: every
 * keyword rule is reported as one of four codes, a destination as two, and so
 * on. This module is that mapping, so the create bar and the drawer both put a
 * `placeholder_count_mismatch` under the destination without deciding for
 * themselves.
 */

import type { Link } from '@golinks/shared/api'
import { existingLink, isApiError, validationFields } from '../../api/errors.ts'

/** The parts of a link form a message can be attached to. */
export type LinkErrorField = 'namespace' | 'keyword' | 'destination' | 'owner' | 'general'

/** A message per field, plus whatever could not be attributed to one. */
export type LinkFieldErrors = Partial<Record<LinkErrorField, string>> & {
  /** The link a keyword collision named, offered to open (spec 08 §4). */
  existingLink?: Link
}

/** Which field each documented code belongs under (spec 05 §4). */
const FIELD_FOR_CODE: Record<string, LinkErrorField> = {
  keyword_invalid: 'keyword',
  keyword_reserved: 'keyword',
  namespace_reserved: 'keyword',
  placeholder_invalid: 'keyword',
  keyword_exists: 'keyword',
  keyword_conflict: 'keyword',
  namespace_invalid: 'namespace',
  destination_invalid: 'destination',
  placeholder_count_mismatch: 'destination',
  owner_invalid: 'owner',
}

/** The names the API uses for fields in a `validation_failed` (spec 05 §4). */
const KNOWN_FIELDS = new Set<string>(['namespace', 'keyword', 'destination', 'ownerId'])

function fieldName(name: string): LinkErrorField {
  return name === 'ownerId' ? 'owner' : (name as LinkErrorField)
}

/**
 * Reads a caught value as field messages.
 *
 * Anything that is not an API refusal — a dropped connection, a bug — becomes a
 * general message, because there is no field to blame and silence would leave
 * the member pressing Save again.
 */
export function linkFieldErrors(error: unknown): LinkFieldErrors {
  if (error === null || error === undefined) {
    return {}
  }

  if (!isApiError(error)) {
    return { general: 'The change could not be saved. Check your connection and try again.' }
  }

  const fields = validationFields(error)
  if (fields) {
    const mapped: LinkFieldErrors = {}
    const unattributed: string[] = []
    for (const [name, message] of Object.entries(fields)) {
      if (KNOWN_FIELDS.has(name)) {
        mapped[fieldName(name)] = message
      } else {
        unattributed.push(`${name}: ${message}`)
      }
    }
    if (unattributed.length > 0) {
      mapped.general = unattributed.join(' ')
    }
    return Object.keys(mapped).length > 0 ? mapped : { general: error.message }
  }

  const field = FIELD_FOR_CODE[error.code]
  const collided = existingLink(error)

  const result: LinkFieldErrors = {}
  result[field ?? 'general'] = error.message
  if (collided) {
    result.existingLink = collided
  }
  return result
}

/** True when every field came back clean. */
export function hasFieldErrors(errors: LinkFieldErrors): boolean {
  return Object.keys(errors).length > 0
}

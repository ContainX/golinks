/**
 * Reading the refusals a settings change can come back with (spec 06 §2-3,
 * spec 05 §4).
 *
 * Four of the fields in the settings document describe the keyword space every
 * link of the organization lives in, so the API answers a change to one of them
 * with the links that stand in the way — not just a message. Those lists arrive
 * in `details`, whose shape depends on the code; this module turns them into
 * something the form can render beside the field that caused it, and says which
 * field that is.
 *
 * A `details` payload that does not parse is not an error in itself: the code
 * and the message still say what happened, so the conflict degrades to its
 * message rather than being dropped.
 */

import { z } from 'zod'
import { isApiError } from '../../../api/errors.ts'

/** A link as a settings refusal names it. */
const LinkReferenceSchema = z.object({
  id: z.string(),
  namespace: z.string(),
  keyword: z.string(),
  fullPath: z.string(),
})

export type SettingsLinkReference = z.infer<typeof LinkReferenceSchema>

const ExplainedLinkSchema = LinkReferenceSchema.extend({ message: z.string() })

export type ExplainedLink = z.infer<typeof ExplainedLinkSchema>

/** `namespace_in_use`: how much each namespace still holds. */
const NamespaceInUseDetailsSchema = z.object({
  namespaces: z.array(z.object({ namespace: z.string(), linkCount: z.number() })).min(1),
})

/** `namespace_conflicts`: the keywords a new namespace would make ambiguous. */
const NamespaceConflictsDetailsSchema = z.object({
  conflicts: z
    .array(z.object({ namespace: z.string(), links: z.array(LinkReferenceSchema) }))
    .min(1),
})

/** `keyword_conflict` from dropping punctuation: keywords that would collapse into one. */
const KeywordCollisionsDetailsSchema = z.object({
  collisions: z
    .array(
      z.object({
        namespace: z.string(),
        keyword: z.string(),
        links: z.array(LinkReferenceSchema),
      }),
    )
    .min(1),
})

/** `keyword_conflict` from prefix fallback: what the mode cannot live with. */
const PrefixFallbackDetailsSchema = z
  .object({
    placeholderViolations: z.array(ExplainedLinkSchema).optional(),
    prefixConflicts: z
      .array(
        z.object({
          namespace: z.string(),
          prefix: z.string(),
          links: z.array(LinkReferenceSchema),
        }),
      )
      .optional(),
  })
  .refine(
    (details) =>
      (details.placeholderViolations?.length ?? 0) > 0 ||
      (details.prefixConflicts?.length ?? 0) > 0,
    'A prefix fallback refusal names at least one link.',
  )

/** `keyword_invalid`: links left with no canonical form at all. */
const KeywordInvalidDetailsSchema = z.object({ links: z.array(ExplainedLinkSchema).min(1) })

/** Which part of the form a refusal belongs beside. */
export type SettingsConflictField = 'namespaces' | 'keywords' | 'settings'

/** A refusal, read and grouped by the field that caused it. */
export type SettingsConflict =
  | {
      field: 'namespaces'
      kind: 'namespaceInUse'
      message: string
      namespaces: { namespace: string; linkCount: number }[]
    }
  | {
      field: 'namespaces'
      kind: 'namespaceConflicts'
      message: string
      conflicts: { namespace: string; links: SettingsLinkReference[] }[]
    }
  | {
      field: 'keywords'
      kind: 'keywordCollisions'
      message: string
      collisions: { namespace: string; keyword: string; links: SettingsLinkReference[] }[]
    }
  | {
      field: 'keywords'
      kind: 'prefixFallback'
      message: string
      placeholderViolations: ExplainedLink[]
      prefixConflicts: { namespace: string; prefix: string; links: SettingsLinkReference[] }[]
    }
  | { field: 'keywords'; kind: 'keywordInvalid'; message: string; links: ExplainedLink[] }
  /** A refusal whose `details` said nothing usable, or one no field owns. */
  | { field: SettingsConflictField; kind: 'message'; message: string }

/**
 * What a failed save means, in the terms the form renders.
 *
 * `validation_failed` is deliberately not one of the answers: its `details`
 * name fields, and the form shows those on the fields themselves through
 * {@link validationFields}.
 */
export function readSettingsConflict(error: unknown): SettingsConflict | null {
  if (!isApiError(error)) {
    return null
  }
  const { code, message, details } = error

  if (code === 'validation_failed') {
    return null
  }

  if (code === 'namespace_in_use') {
    const parsed = NamespaceInUseDetailsSchema.safeParse(details)
    return parsed.success
      ? { field: 'namespaces', kind: 'namespaceInUse', message, namespaces: parsed.data.namespaces }
      : messageOnly('namespaces', message)
  }

  if (code === 'namespace_conflicts') {
    const parsed = NamespaceConflictsDetailsSchema.safeParse(details)
    return parsed.success
      ? {
          field: 'namespaces',
          kind: 'namespaceConflicts',
          message,
          conflicts: parsed.data.conflicts,
        }
      : messageOnly('namespaces', message)
  }

  if (code === 'keyword_conflict') {
    const collisions = KeywordCollisionsDetailsSchema.safeParse(details)
    if (collisions.success) {
      return {
        field: 'keywords',
        kind: 'keywordCollisions',
        message,
        collisions: collisions.data.collisions,
      }
    }
    const prefixFallback = PrefixFallbackDetailsSchema.safeParse(details)
    if (prefixFallback.success) {
      return {
        field: 'keywords',
        kind: 'prefixFallback',
        message,
        placeholderViolations: prefixFallback.data.placeholderViolations ?? [],
        prefixConflicts: prefixFallback.data.prefixConflicts ?? [],
      }
    }
    return messageOnly('keywords', message)
  }

  if (code === 'keyword_invalid') {
    const parsed = KeywordInvalidDetailsSchema.safeParse(details)
    return parsed.success
      ? { field: 'keywords', kind: 'keywordInvalid', message, links: parsed.data.links }
      : messageOnly('keywords', message)
  }

  return messageOnly('settings', message)
}

/** A refusal kept beside a field, with only what the API said about it. */
function messageOnly(field: SettingsConflictField, message: string): SettingsConflict {
  return { field, kind: 'message', message }
}

import { z } from 'zod'
import {
  ApiIdSchema,
  BooleanQuerySchema,
  CursorSchema,
  EmailSchema,
  ListLimitSchema,
  listEnvelopeSchema,
  SortOrderSchema,
  TimestampSchema,
} from './common.ts'

/** Link resource and request shapes (spec 05 sections 2.1 and 3, spec 03). */

/**
 * How long a keyword or destination may be before the request is rejected on shape alone.
 *
 * These are payload bounds, not the product rules: keyword normalization (spec 03 section 2.1)
 * and destination rules (spec 03 section 3) run afterwards and report `keyword_invalid` or
 * `destination_invalid`, which say far more than a schema failure would.
 */
const KEYWORD_INPUT_MAX_LENGTH = 512
const DESTINATION_INPUT_MAX_LENGTH = 4096

/** The owner of a link as every member of the organization sees them (spec 03 section 4). */
export const LinkOwnerSchema = z.object({
  id: ApiIdSchema,
  email: EmailSchema,
})
export type LinkOwner = z.infer<typeof LinkOwnerSchema>

/** What the requesting member may do to this link, computed per spec 03 section 5. */
export const LinkPermissionsSchema = z.object({
  canEditDestination: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  canTransfer: z.boolean(),
})
export type LinkPermissions = z.infer<typeof LinkPermissionsSchema>

export const LinkSchema = z.object({
  id: ApiIdSchema,
  namespace: z.string().min(1),
  /** Canonical keyword: what lookups and uniqueness use (spec 03 section 2.2). */
  keyword: z.string().min(1),
  /** Normalized as entered: what the directory shows (spec 03 section 2.1). */
  displayKeyword: z.string().min(1),
  /** `namespace/displayKeyword`, ready to show or copy. */
  fullPath: z.string().min(1),
  destination: z.string().min(1),
  isProgrammatic: z.boolean(),
  placeholderCount: z.number().int().min(0),
  isUnlisted: z.boolean(),
  owner: LinkOwnerSchema,
  visitCount: z.number().int().min(0),
  lastVisitedAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  permissions: LinkPermissionsSchema,
})
export type Link = z.infer<typeof LinkSchema>

/** A link reduced to what a transfer preview shows (spec 05 section 2.4). */
export const LinkSummarySchema = z.object({
  id: ApiIdSchema,
  fullPath: z.string().min(1),
  destination: z.string().min(1),
  owner: LinkOwnerSchema,
})
export type LinkSummary = z.infer<typeof LinkSummarySchema>

const KeywordInputSchema = z
  .string()
  .trim()
  .min(1, 'A keyword is required.')
  .max(KEYWORD_INPUT_MAX_LENGTH)

const DestinationInputSchema = z
  .string()
  .trim()
  .min(1, 'A destination is required.')
  .max(DESTINATION_INPUT_MAX_LENGTH)

const NamespaceInputSchema = z.string().trim().min(1, 'A namespace is required.').max(30)

/** `POST /links` body. `namespace` falls back to the organization's default namespace. */
export const LinkCreateBodySchema = z.strictObject({
  namespace: NamespaceInputSchema.optional(),
  keyword: KeywordInputSchema,
  destination: DestinationInputSchema,
  isUnlisted: z.boolean().default(false),
  /** Admins only; defaults to the caller (spec 03 section 6). */
  ownerId: ApiIdSchema.optional(),
})
export type LinkCreateBody = z.infer<typeof LinkCreateBodySchema>

/** `PATCH /links/:id` body: any non-empty subset of the editable fields (spec 03 section 7). */
export const LinkPatchBodySchema = z
  .strictObject({
    destination: DestinationInputSchema.optional(),
    keyword: KeywordInputSchema.optional(),
    namespace: NamespaceInputSchema.optional(),
    isUnlisted: z.boolean().optional(),
    ownerId: ApiIdSchema.optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide at least one field to change.',
  )
export type LinkPatchBody = z.infer<typeof LinkPatchBodySchema>

/** Column the directory sorts by (spec 03 section 10.1). */
export const LinkSortSchema = z.enum(['visits', 'keyword', 'created', 'updated'])
export type LinkSort = z.infer<typeof LinkSortSchema>

/** `GET /links` query parameters (spec 03 section 10.1). */
export const LinkListQuerySchema = z.strictObject({
  /** Substring match against the display keyword, the destination, and the owner's email. */
  q: z.string().trim().max(200).optional(),
  namespace: NamespaceInputSchema.optional(),
  /** `me` or a user id. */
  owner: ApiIdSchema.optional(),
  programmatic: BooleanQuerySchema.optional(),
  sort: LinkSortSchema.default('visits'),
  order: SortOrderSchema.default('desc'),
  limit: ListLimitSchema,
  cursor: CursorSchema.optional(),
})
export type LinkListQuery = z.infer<typeof LinkListQuerySchema>

/** Suggestions never page, so they carry their own smaller limit (spec 03 section 10.2). */
export const DEFAULT_SUGGESTION_LIMIT = 5
export const MAX_SUGGESTION_LIMIT = 20

/** `GET /links/suggestions` query parameters. */
export const LinkSuggestionsQuerySchema = z.strictObject({
  keyword: KeywordInputSchema,
  namespace: NamespaceInputSchema.optional(),
  limit: z.coerce
    .number()
    .int('limit must be a whole number.')
    .min(1, 'limit must be at least 1.')
    .max(MAX_SUGGESTION_LIMIT, `limit must be at most ${MAX_SUGGESTION_LIMIT}.`)
    .default(DEFAULT_SUGGESTION_LIMIT),
})
export type LinkSuggestionsQuery = z.infer<typeof LinkSuggestionsQuerySchema>

/** `:id` on every `/links/:id` route. */
export const LinkIdParamsSchema = z.strictObject({ id: ApiIdSchema })
export type LinkIdParams = z.infer<typeof LinkIdParamsSchema>

/** `GET /links` response. */
export const LinkListResponseSchema = listEnvelopeSchema(LinkSchema)
export type LinkListResponse = z.infer<typeof LinkListResponseSchema>

/** `GET /links/suggestions` response: ranked matches, without a cursor. */
export const LinkSuggestionsResponseSchema = z.object({ items: z.array(LinkSchema) })
export type LinkSuggestionsResponse = z.infer<typeof LinkSuggestionsResponseSchema>

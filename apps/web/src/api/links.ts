/**
 * The link endpoints (spec 05 §3), which is most of what the app does: the
 * directory (spec 08 §3), creating and editing (spec 08 §4, §5), the
 * suggestions a resolver miss leads to (spec 03 §10.2), and handing a link to
 * someone else (spec 03 §9.2).
 */

import type {
  Link,
  LinkListQuery,
  LinkListResponse,
  LinkSuggestionsQuery,
  LinkSuggestionsResponse,
  Transfer,
} from '@golinks/shared/api'
import {
  LinkCreateBodySchema,
  LinkListQuerySchema,
  LinkListResponseSchema,
  LinkPatchBodySchema,
  LinkSchema,
  LinkSuggestionsQuerySchema,
  LinkSuggestionsResponseSchema,
  TransferSchema,
} from '@golinks/shared/api'
import type { z } from 'zod'
import { apiFetch } from './http.ts'
import type { RequestOptions } from './resource.ts'
import { buildQuery, parseRequestBody, parseResponse, requestInit } from './resource.ts'

const LINKS_PATH = '/links'

function linkPath(id: string): string {
  return `${LINKS_PATH}/${encodeURIComponent(id)}`
}

/**
 * `GET /links` parameters (spec 03 §10.1). Every one is optional: the API
 * applies the same defaults the shared schema declares.
 */
export type LinkListParams = Partial<LinkListQuery>

/** `GET /links/suggestions` parameters. The keyword to rank against is required. */
export type LinkSuggestionsParams = Partial<LinkSuggestionsQuery> &
  Pick<LinkSuggestionsQuery, 'keyword'>

/**
 * `POST /links` body.
 *
 * The schema's input rather than its output, so that a caller may leave
 * `isUnlisted` out and let the default stand.
 */
export type LinkCreateInput = z.input<typeof LinkCreateBodySchema>

/** `PATCH /links/:id` body: any non-empty subset of the editable fields. */
export type LinkPatchInput = z.input<typeof LinkPatchBodySchema>

/** `GET /links`: one page of the directory, with the cursor for the next. */
export async function listLinks(
  params: LinkListParams = {},
  options: RequestOptions = {},
): Promise<LinkListResponse> {
  const query = buildQuery(LinkListQuerySchema, params, 'GET /links')
  const body = await apiFetch(`${LINKS_PATH}${query}`, requestInit(options))
  return parseResponse(LinkListResponseSchema, body, 'link list')
}

/** `GET /links/:id`. */
export async function getLink(id: string, options: RequestOptions = {}): Promise<Link> {
  const body = await apiFetch(linkPath(id), requestInit(options))
  return parseResponse(LinkSchema, body, 'Link')
}

/** `POST /links`: 201 with the created link. */
export async function createLink(
  body: LinkCreateInput,
  options: RequestOptions = {},
): Promise<Link> {
  const json = parseRequestBody(LinkCreateBodySchema, body, 'POST /links')
  const result = await apiFetch(LINKS_PATH, requestInit(options, { method: 'POST', json }))
  return parseResponse(LinkSchema, result, 'Link')
}

/** `PATCH /links/:id`: the link as it stands after the change. */
export async function patchLink(
  id: string,
  body: LinkPatchInput,
  options: RequestOptions = {},
): Promise<Link> {
  const json = parseRequestBody(LinkPatchBodySchema, body, 'PATCH /links/:id')
  const result = await apiFetch(linkPath(id), requestInit(options, { method: 'PATCH', json }))
  return parseResponse(LinkSchema, result, 'Link')
}

/** `DELETE /links/:id`: 204, nothing to parse. */
export async function deleteLink(id: string, options: RequestOptions = {}): Promise<void> {
  await apiFetch(linkPath(id), requestInit(options, { method: 'DELETE' }))
}

/**
 * `GET /links/suggestions`: links whose keyword resembles the one asked about,
 * which is what a member is offered after a resolver miss (spec 04 §8).
 */
export async function suggestLinks(
  params: LinkSuggestionsParams,
  options: RequestOptions = {},
): Promise<LinkSuggestionsResponse> {
  const query = buildQuery(LinkSuggestionsQuerySchema, params, 'GET /links/suggestions')
  const body = await apiFetch(`${LINKS_PATH}/suggestions${query}`, requestInit(options))
  return parseResponse(LinkSuggestionsResponseSchema, body, 'link suggestions')
}

/**
 * `POST /links/:id/transfers`: 201 with the one-time URL to hand to the member
 * who is to take the link over (spec 03 §9.2).
 */
export async function createTransfer(
  linkId: string,
  options: RequestOptions = {},
): Promise<Transfer> {
  const result = await apiFetch(
    `${linkPath(linkId)}/transfers`,
    requestInit(options, { method: 'POST' }),
  )
  return parseResponse(TransferSchema, result, 'Transfer')
}

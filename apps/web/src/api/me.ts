/**
 * The session and profile endpoints (spec 05 §3).
 *
 * `GET /me` is the app's first request: it says who the member is, what the
 * organization has configured, and what the deployment calls itself, all of
 * which the shell and the theme are built from (spec 08 §1).
 */

import type { Me, MePatchBody } from '@golinks/shared/api'
import { MePatchBodySchema, MeSchema } from '@golinks/shared/api'
import { apiFetch } from './http.ts'
import type { RequestOptions } from './resource.ts'
import { parseRequestBody, parseResponse, requestInit } from './resource.ts'

const ME_PATH = '/me'

/** `GET /me`: the signed-in member, their organization, and the deployment. */
export async function getMe(options: RequestOptions = {}): Promise<Me> {
  const body = await apiFetch(ME_PATH, requestInit(options))
  return parseResponse(MeSchema, body, 'Me')
}

/**
 * `PATCH /me`: stores the member's own preferences (spec 01 §2.5).
 *
 * Only the whitelisted keys of the shared schema are accepted; anything else is
 * refused here rather than by the API.
 */
export async function patchMe(body: MePatchBody, options: RequestOptions = {}): Promise<Me> {
  const json = parseRequestBody(MePatchBodySchema, body, 'PATCH /me')
  const result = await apiFetch(ME_PATH, requestInit(options, { method: 'PATCH', json }))
  return parseResponse(MeSchema, result, 'Me')
}

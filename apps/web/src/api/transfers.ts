/**
 * The transfer endpoints (spec 05 §3): what the acceptance screen at
 * `/_/transfer/:token` looks at, and what it does (spec 03 §9.2, spec 08 §6).
 */

import type { Link, TransferPreview } from '@golinks/shared/api'
import { LinkSchema, TransferPreviewSchema } from '@golinks/shared/api'
import { apiFetch } from './http.ts'
import type { RequestOptions } from './resource.ts'
import { parseResponse, requestInit } from './resource.ts'

function transferPath(token: string): string {
  return `/transfers/${encodeURIComponent(token)}`
}

/**
 * `GET /transfers/:token`: what is on offer and whether it still stands, read
 * before anything changes hands.
 */
export async function previewTransfer(
  token: string,
  options: RequestOptions = {},
): Promise<TransferPreview> {
  const body = await apiFetch(transferPath(token), requestInit(options))
  return parseResponse(TransferPreviewSchema, body, 'TransferPreview')
}

/** `POST /transfers/:token/accept`: the link, now owned by the caller. */
export async function acceptTransfer(token: string, options: RequestOptions = {}): Promise<Link> {
  const body = await apiFetch(
    `${transferPath(token)}/accept`,
    requestInit(options, { method: 'POST' }),
  )
  return parseResponse(LinkSchema, body, 'Link')
}

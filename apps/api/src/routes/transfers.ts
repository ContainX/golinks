// The transfer endpoints of spec 05 §3: previewing a transfer link and accepting it.
//
// Creating one lives with the link it hands on (`POST /links/:id/transfers`); these two are
// addressed by the token instead, because whoever follows the URL has nothing else to go on.
// Both are ordinary signed-in requests: a token is an invitation, never an authentication.

import {
  API_BASE_PATH,
  LinkSchema,
  TransferPreviewSchema,
  TransferTokenParamsSchema,
} from '@golinks/shared/api'
import { requireMember } from '../auth/guards.ts'
import { acceptTransferWithChecks, existingLinkResource, previewTransfer } from '../links/index.ts'
import type { GoLinksApp } from '../types.ts'

const TRANSFERS_URL = `${API_BASE_PATH}/transfers`

export function registerTransferRoutes(app: GoLinksApp): void {
  app.route({
    method: 'GET',
    url: `${TRANSFERS_URL}/:token`,
    schema: { params: TransferTokenParamsSchema, response: { 200: TransferPreviewSchema } },
    handler: async (request) => {
      const member = requireMember(request)
      // Reads only: the acceptance page shows where the transfer stands before anything moves.
      return await previewTransfer(app.db, { token: request.params.token, member })
    },
  })

  app.route({
    method: 'POST',
    url: `${TRANSFERS_URL}/:token/accept`,
    schema: { params: TransferTokenParamsSchema, response: { 200: LinkSchema } },
    handler: async (request) => {
      const member = requireMember(request)
      const settings = await app.organizationSettings.getSettings(member.organizationId)

      const row = await acceptTransferWithChecks(app.db, {
        token: request.params.token,
        member,
        settings,
        requestId: request.id,
      })

      // The member who just accepted is the new owner, so the resource comes back with the
      // permissions that fact gives them (spec 03 §5).
      const resource = await existingLinkResource(app.db, row, { member, settings })
      if (resource === undefined) throw new Error(`Link ${row.id} has no owner.`)
      return resource
    },
  })
}

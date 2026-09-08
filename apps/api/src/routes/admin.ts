// The admin endpoints of spec 05 §3: organization settings, members, and the audit feed.
//
// Every route starts with `requireAdmin`, so a caller without a session gets 401 and a member
// without the role gets 403 (spec 02 §5). Everything else here is plumbing: the rules for a
// settings write live in `organizations/settings-rules.ts`, the member rules in `users/`, and
// the feed's query in `admin/events.ts`, so a handler reads as the endpoint's contract and
// nothing more.

import {
  AdminEventsQuerySchema,
  AdminSettingsPutBodySchema,
  AdminSettingsResponseSchema,
  AdminUserListResponseSchema,
  AdminUserPatchBodySchema,
  AdminUserSchema,
  AdminUsersQuerySchema,
  API_BASE_PATH,
  AuditEventListResponseSchema,
  UserIdParamsSchema,
} from '@golinks/shared/api'
import { listAuditEvents, parseAuditEventCursor } from '../admin/events.ts'
import { updateOrganizationSettings } from '../admin/settings.ts'
import { requireAdmin } from '../auth/guards.ts'
import { memberCacheOf } from '../auth/member-cache.ts'
import { validationFailed } from '../errors.ts'
import type { CurrentMember, GoLinksApp } from '../types.ts'
import {
  changeOrganizationUser,
  listOrganizationUsers,
  readOrganizationUser,
} from '../users/index.ts'

/** Where every endpoint in this module hangs (spec 05 §3). */
export const ADMIN_BASE_PATH = `${API_BASE_PATH}/admin`

/** The admin's row id for the audit trail; null if their session ever carried something else. */
function actorUserIdOf(member: CurrentMember): number | null {
  const parsed = Number(member.id)
  return Number.isSafeInteger(parsed) ? parsed : null
}

export function registerAdminRoutes(app: GoLinksApp): void {
  app.route({
    method: 'GET',
    url: `${ADMIN_BASE_PATH}/settings`,
    schema: { response: { 200: AdminSettingsResponseSchema } },
    handler: async (request) => {
      const member = requireAdmin(request)
      // The whole document, `admins` included: `GET /me` is the view that leaves it out.
      return await app.organizationSettings.getSettings(member.organizationId)
    },
  })

  app.route({
    method: 'PUT',
    url: `${ADMIN_BASE_PATH}/settings`,
    schema: {
      body: AdminSettingsPutBodySchema,
      response: { 200: AdminSettingsResponseSchema },
    },
    handler: async (request) => {
      const member = requireAdmin(request)
      // The body is the whole document (spec 06 §2), already filled with defaults by the
      // shared schema; anything it rejected became a `validation_failed` before this ran.
      return await updateOrganizationSettings({
        db: app.db,
        settings: app.organizationSettings,
        organizationId: member.organizationId,
        document: request.body,
        actorUserId: actorUserIdOf(member),
        requestId: request.id,
      })
    },
  })

  app.route({
    method: 'GET',
    url: `${ADMIN_BASE_PATH}/users`,
    schema: {
      querystring: AdminUsersQuerySchema,
      response: { 200: AdminUserListResponseSchema },
    },
    handler: async (request) => {
      const member = requireAdmin(request)
      return await listOrganizationUsers(app.db, member.organizationId, request.query)
    },
  })

  app.route({
    method: 'GET',
    url: `${ADMIN_BASE_PATH}/users/:id`,
    schema: { params: UserIdParamsSchema, response: { 200: AdminUserSchema } },
    handler: async (request) => {
      const member = requireAdmin(request)
      return await readOrganizationUser(app.db, member.organizationId, request.params.id)
    },
  })

  app.route({
    method: 'PATCH',
    url: `${ADMIN_BASE_PATH}/users/:id`,
    schema: {
      params: UserIdParamsSchema,
      body: AdminUserPatchBodySchema,
      response: { 200: AdminUserSchema },
    },
    handler: async (request) => {
      const member = requireAdmin(request)
      const updated = await changeOrganizationUser(app.db, {
        organizationId: member.organizationId,
        id: request.params.id,
        changes: request.body,
        actor: member,
        requestId: request.id,
      })

      // Spec 01 §2.4 gives a disabled member until their next request; the member cache would
      // otherwise hold the old row for up to a minute (spec 02 §3), so it is dropped here and
      // the very next request reads the row that was just written.
      memberCacheOf(app)?.forget(updated.id)
      return updated
    },
  })

  app.route({
    method: 'GET',
    url: `${ADMIN_BASE_PATH}/events`,
    schema: {
      querystring: AdminEventsQuerySchema,
      response: { 200: AuditEventListResponseSchema },
    },
    handler: async (request) => {
      const member = requireAdmin(request)
      const { cursor, ...filters } = request.query

      const after = cursor === undefined ? undefined : parseAuditEventCursor(cursor)
      if (cursor !== undefined && after === undefined) {
        throw validationFailed({ cursor: 'That cursor did not come from us.' })
      }

      return await listAuditEvents(app.db, {
        organizationId: member.organizationId,
        ...filters,
        after,
      })
    },
  })
}

// `GET /_/api/v1/me` and `PATCH /_/api/v1/me` (spec 05 §2.2 and §3).
//
// The one call the web app makes before it can render anything: who is signed in, what their
// organization has been configured to do, and the two deployment facts the shell needs. The
// organization block is the settings document of spec 06 minus `admins`, which only
// `GET /admin/settings` hands out.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_BASE_PATH, type Me, MePatchBodySchema, MeSchema } from '@golinks/shared/api'
import type { OrganizationSettings } from '@golinks/shared/settings'
import { eq } from 'drizzle-orm'
import { requireMember } from '../auth/guards.ts'
import { type UserRow, users } from '../db/schema/index.ts'
import { notFound } from '../errors.ts'
import type { GoLinksApp } from '../types.ts'

/** Version reported to the web app, read from this package's manifest. */
export const SERVICE_VERSION = readServiceVersion()

/**
 * Walks up from this module for the API package's manifest. The bundled entry point sits one
 * directory below the same manifest, so the same walk works in a container.
 */
function readServiceVersion(): string {
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 8; depth += 1) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
        const version = (parsed as { version?: unknown }).version
        if (typeof version === 'string' && version.length > 0) return version
      } catch {
        break
      }
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return '0.0.0'
}

/** The settings a member may see: everything except the admin list (spec 05 §2.2). */
export function toMeOrganization(id: string, settings: OrganizationSettings): Me['organization'] {
  const { admins: _admins, ...visible } = settings
  return { id, ...visible }
}

function toMeUser(row: UserRow): Me['user'] {
  return {
    id: String(row.id),
    email: row.email,
    role: row.role,
    organizationId: row.organizationId,
    preferences: row.preferences,
    createdAt: row.createdAt.toISOString(),
  }
}

export function registerMeRoutes(app: GoLinksApp): void {
  const config = app.appConfig

  async function readUser(id: string): Promise<UserRow> {
    const rows = await app.db
      .select()
      .from(users)
      .where(eq(users.id, Number(id)))
      .limit(1)
    const row = rows[0]
    // The member resolver just read this row, so its absence means it went in between.
    if (row === undefined) throw notFound('Your account no longer exists.')
    return row
  }

  async function buildMe(row: UserRow): Promise<Me> {
    const settings = await app.organizationSettings.getSettings(row.organizationId)
    return {
      user: toMeUser(row),
      organization: toMeOrganization(row.organizationId, settings),
      app: {
        baseUrl: config.baseUrl,
        shortHost: config.shortHost,
        version: SERVICE_VERSION,
      },
    }
  }

  app.route({
    method: 'GET',
    url: `${API_BASE_PATH}/me`,
    schema: { response: { 200: MeSchema } },
    handler: async (request) => buildMe(await readUser(requireMember(request).id)),
  })

  app.route({
    method: 'PATCH',
    url: `${API_BASE_PATH}/me`,
    schema: { body: MePatchBodySchema, response: { 200: MeSchema } },
    handler: async (request) => {
      const member = requireMember(request)
      // The body carries the whole preferences document, so sending `{}` clears it. Unknown
      // keys never reach here: the shared schema rejects them as `validation_failed`.
      const rows = await app.db
        .update(users)
        .set({ preferences: request.body.preferences, updatedAt: new Date() })
        .where(eq(users.id, Number(member.id)))
        .returning()
      const row = rows[0]
      if (row === undefined) throw notFound('Your account no longer exists.')
      return buildMe(row)
    },
  })
}

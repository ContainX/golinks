// The link endpoints of spec 05 §3.
//
// Handlers here do three things and nothing else: name the member the request acts as, load the
// organization's settings, and hand both to the links module. Every product rule — the
// validation order of spec 03 §6, the permission table of spec 03 §5, conflict detection, the
// audit trail — lives there, so an endpoint is a shape, not a policy.
//
// Requests and responses are validated against the shared schemas, which is what turns a
// malformed body into `validation_failed` and keeps a response honest about its own shape.

import {
  API_BASE_PATH,
  type Link,
  LinkCreateBodySchema,
  LinkIdParamsSchema,
  LinkListQuerySchema,
  LinkListResponseSchema,
  LinkPatchBodySchema,
  LinkSchema,
  LinkSuggestionsQuerySchema,
  LinkSuggestionsResponseSchema,
  TransferSchema,
} from '@golinks/shared/api'
import type { OrganizationSettings } from '@golinks/shared/settings'
import { requireMember } from '../auth/guards.ts'
import type { LinkRow } from '../db/schema/index.ts'
import { notFound } from '../errors.ts'
import {
  createLinkWithChecks,
  createTransferWithChecks,
  deleteLinkWithChecks,
  existingLinkResource,
  findById,
  type LinkWriteContext,
  listLinks,
  renameLinkWithChecks,
  suggestLinks,
  toLinkResources,
  transferUrl,
} from '../links/index.ts'
import type { CurrentMember, GoLinksApp } from '../types.ts'

const LINKS_URL = `${API_BASE_PATH}/links`

/**
 * Ids travel as strings (spec 05 §1) but address a bigint column. Anything that is not one of
 * ours is missing rather than malformed, which is also the answer another tenant's id gets.
 */
function linkIdOf(raw: string): number {
  const id = Number(raw)
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound('That link does not exist.')
  return id
}

export function registerLinkRoutes(app: GoLinksApp): void {
  const config = app.appConfig

  function contextFor(
    member: CurrentMember,
    settings: OrganizationSettings,
    requestId: string,
  ): LinkWriteContext {
    return { member, settings, requestId }
  }

  /** The link as this member sees it, owner and permissions included (spec 05 §2.1). */
  async function resourceOf(row: LinkRow, context: LinkWriteContext): Promise<Link> {
    const resource = await existingLinkResource(app.db, row, context)
    // The owner is a foreign key to a row that is never deleted (spec 01 §2.4).
    if (resource === undefined) throw new Error(`Link ${row.id} has no owner.`)
    return resource
  }

  /** One link of the caller's organization; another tenant's id reads as missing (spec 03 §5). */
  async function loadLink(member: CurrentMember, raw: string): Promise<LinkRow> {
    const row = await findById(app.db, member.organizationId, linkIdOf(raw))
    if (row === undefined) throw notFound('That link does not exist.')
    return row
  }

  app.route({
    method: 'POST',
    url: LINKS_URL,
    // Spec 05 §5: creation has a budget of its own, tighter than the rest of the API.
    config: { rateLimit: app.rateLimits.linkCreate },
    schema: { body: LinkCreateBodySchema, response: { 201: LinkSchema } },
    handler: async (request, reply) => {
      const member = requireMember(request)
      const settings = await app.organizationSettings.getSettings(member.organizationId)
      const context = contextFor(member, settings, request.id)
      const body = request.body

      const row = await createLinkWithChecks(app.db, {
        ...context,
        namespace: body.namespace,
        keyword: body.keyword,
        destination: body.destination,
        isUnlisted: body.isUnlisted,
        ownerId: body.ownerId === undefined ? undefined : Number(body.ownerId),
      })

      return reply.code(201).send(await resourceOf(row, context))
    },
  })

  app.route({
    method: 'GET',
    url: LINKS_URL,
    schema: { querystring: LinkListQuerySchema, response: { 200: LinkListResponseSchema } },
    handler: async (request) => {
      const member = requireMember(request)
      const settings = await app.organizationSettings.getSettings(member.organizationId)
      const page = await listLinks(app.db, { member, query: request.query })
      return { items: toLinkResources(page.items, member, settings), nextCursor: page.nextCursor }
    },
  })

  // Declared before `/links/:id` so that `suggestions` is read as itself and not as an id.
  app.route({
    method: 'GET',
    url: `${LINKS_URL}/suggestions`,
    schema: {
      querystring: LinkSuggestionsQuerySchema,
      response: { 200: LinkSuggestionsResponseSchema },
    },
    handler: async (request) => {
      const member = requireMember(request)
      const settings = await app.organizationSettings.getSettings(member.organizationId)
      const rows = await suggestLinks(app.db, {
        member,
        settings,
        keyword: request.query.keyword,
        namespace: request.query.namespace,
        limit: request.query.limit,
        minSimilarity: config.suggestions.minSimilarity,
      })
      return { items: toLinkResources(rows, member, settings) }
    },
  })

  app.route({
    method: 'GET',
    url: `${LINKS_URL}/:id`,
    schema: { params: LinkIdParamsSchema, response: { 200: LinkSchema } },
    handler: async (request) => {
      const member = requireMember(request)
      const settings = await app.organizationSettings.getSettings(member.organizationId)
      const row = await loadLink(member, request.params.id)
      return await resourceOf(row, contextFor(member, settings, request.id))
    },
  })

  app.route({
    method: 'PATCH',
    url: `${LINKS_URL}/:id`,
    schema: {
      params: LinkIdParamsSchema,
      body: LinkPatchBodySchema,
      response: { 200: LinkSchema },
    },
    handler: async (request) => {
      const member = requireMember(request)
      const settings = await app.organizationSettings.getSettings(member.organizationId)
      const context = contextFor(member, settings, request.id)
      const link = await loadLink(member, request.params.id)
      const body = request.body

      // An admin naming another owner here is the direct assignment of spec 03 §9.1; the
      // transfer-link path says so for itself.
      const row = await renameLinkWithChecks(app.db, {
        ...context,
        link,
        keyword: body.keyword,
        namespace: body.namespace,
        destination: body.destination,
        isUnlisted: body.isUnlisted,
        ownerId: body.ownerId === undefined ? undefined : Number(body.ownerId),
        transferMethod: 'direct',
      })

      return await resourceOf(row, context)
    },
  })

  app.route({
    method: 'DELETE',
    url: `${LINKS_URL}/:id`,
    schema: { params: LinkIdParamsSchema },
    handler: async (request, reply) => {
      const member = requireMember(request)
      const settings = await app.organizationSettings.getSettings(member.organizationId)
      const link = await loadLink(member, request.params.id)
      await deleteLinkWithChecks(app.db, { ...contextFor(member, settings, request.id), link })
      return reply.code(204).send()
    },
  })

  app.route({
    method: 'POST',
    url: `${LINKS_URL}/:id/transfers`,
    schema: { params: LinkIdParamsSchema, response: { 201: TransferSchema } },
    handler: async (request, reply) => {
      const member = requireMember(request)
      const settings = await app.organizationSettings.getSettings(member.organizationId)
      const link = await loadLink(member, request.params.id)

      const created = await createTransferWithChecks(app.db, {
        member,
        settings,
        requestId: request.id,
        link,
        tokenTtlMs: config.transfers.tokenTtlMs,
      })

      // The only time the token itself leaves this process; the row keeps only its hash.
      return reply.code(201).send({
        id: String(created.transfer.id),
        url: transferUrl(config.baseUrl, created.token),
        expiresAt: created.transfer.expiresAt.toISOString(),
      })
    },
  })
}

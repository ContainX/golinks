// The OpenAPI document spec 05 §1 promises, assembled from the same zod schemas the routes
// validate with.
//
// Nothing here describes an endpoint twice. `fastify-type-provider-zod` turns each route's
// zod schemas into JSON Schema, and this module only decides three things on top of that:
// which routes belong in the document, which resource each operation is filed under, and
// which errors of spec 05 §4 an operation can answer with. A route that changes its schema
// changes the document with it; a route added under `/_/api/v1` appears without being
// mentioned here, tagged by its path.

import type { SwaggerTransform, SwaggerTransformObject } from '@fastify/swagger'
import { API_BASE_PATH, ApiErrorBodySchema } from '@golinks/shared/api'
import type { FastifySchema } from 'fastify'
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod'
import { z } from 'zod'

/** Where the document itself is served (spec 05 §3). */
export const OPENAPI_PATH = `${API_BASE_PATH}/openapi.json`

/** The version of the specification the document declares. */
export const OPENAPI_VERSION = '3.1.0'

/** The one component every error response points at. */
export const API_ERROR_SCHEMA_NAME = 'ApiError'
const API_ERROR_REF = `#/components/schemas/${API_ERROR_SCHEMA_NAME}`

/** The resources of spec 05 §3, in the order that specification lists them. */
export const OPENAPI_TAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: 'me', description: 'The current member, their organization settings, and app info.' },
  {
    name: 'links',
    description: 'The link directory: creating, reading, changing, deleting, and handing on.',
  },
  { name: 'transfers', description: 'Previewing a transfer link and accepting it.' },
  { name: 'admin', description: 'Organization settings, members, and the audit feed.' },
]

/**
 * How each error status of spec 05 §4 reads in the document. Every one of them carries the
 * envelope of spec 05 §4, so they all point at the same component.
 */
const ERROR_DESCRIPTIONS: Readonly<Record<number, string>> = {
  400: 'The request failed validation, or a keyword, namespace, destination, or owner rule.',
  401: 'No valid session.',
  403: 'The permission table denies the action, the organization is read-only, or the Origin did not match.',
  404: 'Missing, or belongs to another organization.',
  409: 'The change collides with an existing keyword, namespace, or transfer.',
}

/** How a declared success status reads. The zod schema underneath says the rest. */
const SUCCESS_DESCRIPTIONS: Readonly<Record<number, string>> = {
  200: 'The request succeeded.',
  201: 'The resource was created.',
  204: 'The request succeeded and there is no body.',
}

/** What this module knows about one operation beyond what its schemas already say. */
interface OperationDoc {
  /** One line, taken from the endpoint's row in spec 05 §3. */
  summary: string
  /** Whether the operation can answer 409 (spec 05 §4). */
  conflict?: boolean
  /** A success status the route's own schema leaves undeclared, such as the 204 of a delete. */
  emptySuccess?: { status: number; description: string }
}

/**
 * Spec 05 §3, endpoint for endpoint. A route missing from this table is still documented —
 * it simply carries no summary — so the document never goes stale in the one direction that
 * matters, which is leaving an endpoint out.
 */
const OPERATIONS: Readonly<Record<string, OperationDoc>> = {
  [`GET ${API_BASE_PATH}/me`]: {
    summary: 'The current member, organization settings, and app info.',
  },
  [`PATCH ${API_BASE_PATH}/me`]: {
    summary: 'Replace the preferences of the current member. Whitelisted keys only.',
  },
  [`GET ${API_BASE_PATH}/links`]: { summary: 'List links.' },
  [`POST ${API_BASE_PATH}/links`]: { summary: 'Create a link.', conflict: true },
  [`GET ${API_BASE_PATH}/links/suggestions`]: {
    summary: 'Links whose keyword is close to the one being typed.',
  },
  [`GET ${API_BASE_PATH}/links/:id`]: { summary: 'One link.' },
  [`PATCH ${API_BASE_PATH}/links/:id`]: {
    summary: 'Change the destination, keyword, namespace, listing, or owner of a link.',
    conflict: true,
  },
  [`DELETE ${API_BASE_PATH}/links/:id`]: {
    summary: 'Delete a link.',
    emptySuccess: { status: 204, description: 'The link was deleted.' },
  },
  [`POST ${API_BASE_PATH}/links/:id/transfers`]: {
    summary: 'Create a transfer link that hands this link to whoever accepts it.',
  },
  [`GET ${API_BASE_PATH}/transfers/:token`]: {
    summary: 'Preview a transfer link.',
  },
  [`POST ${API_BASE_PATH}/transfers/:token/accept`]: {
    summary: 'Accept a transfer link. Returns the link with its new owner.',
    conflict: true,
  },
  [`GET ${API_BASE_PATH}/admin/users`]: { summary: 'List the members of the organization.' },
  [`GET ${API_BASE_PATH}/admin/users/:id`]: { summary: 'One member of the organization.' },
  [`PATCH ${API_BASE_PATH}/admin/users/:id`]: {
    summary: 'Enable, disable, or change the role of a member.',
  },
  [`GET ${API_BASE_PATH}/admin/settings`]: { summary: 'The organization settings document.' },
  [`PUT ${API_BASE_PATH}/admin/settings`]: {
    summary: 'Replace the organization settings document.',
    conflict: true,
  },
  [`GET ${API_BASE_PATH}/admin/events`]: { summary: 'The audit feed.' },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a route belongs in the document: the JSON API of spec 05, and nothing else. */
export function isDocumentedRoute(url: string): boolean {
  // The document is not one of the endpoints it documents (spec 05 §3 files it apart).
  if (url === OPENAPI_PATH) return false
  return url === API_BASE_PATH || url.startsWith(`${API_BASE_PATH}/`)
}

/** The resource an operation is filed under, read from its path. */
export function tagForRoute(url: string): string | undefined {
  const rest = url.slice(API_BASE_PATH.length)
  for (const { name } of OPENAPI_TAGS) {
    if (rest === `/${name}` || rest.startsWith(`/${name}/`)) return name
  }
  return undefined
}

/**
 * The errors of spec 05 §4 an operation can answer with.
 *
 * Every endpoint needs a session, so 401 is universal. A body or a query string can fail
 * validation; a state-changing request is also held to the Origin check of spec 02 §6 and to
 * the read-only rule, and an admin endpoint to the role; an addressed resource can be missing.
 * The conflicts are named per operation because only the specification knows where they arise.
 */
export function errorStatusesFor(
  method: string,
  url: string,
  schema: FastifySchema | undefined,
): number[] {
  const statuses = new Set<number>([401])
  if (schema?.body !== undefined || schema?.querystring !== undefined) statuses.add(400)
  if (method !== 'GET' || tagForRoute(url) === 'admin') statuses.add(403)
  if (schema?.params !== undefined) statuses.add(404)
  if (OPERATIONS[`${method} ${url}`]?.conflict === true) statuses.add(409)
  return [...statuses].sort((left, right) => left - right)
}

/** The error envelope of spec 05 §4 as the document's one reusable component. */
export function apiErrorComponentSchema(): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(ApiErrorBodySchema, {
    target: 'draft-2020-12',
    io: 'output',
    unrepresentable: 'any',
  }) as Record<string, unknown>
  return {
    ...schema,
    title: API_ERROR_SCHEMA_NAME,
    description: 'The error envelope of every failed request.',
  }
}

/** One error response, pointing at the shared component. */
function errorResponse(status: number): Record<string, unknown> {
  return { $ref: API_ERROR_REF, description: ERROR_DESCRIPTIONS[status] ?? 'The request failed.' }
}

/**
 * Names a success response the route already declares.
 *
 * The schema moves into a `content` block so that the sentence describing the response does
 * not end up inside the schema describing the body.
 */
function describedSuccess(
  status: number,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if ('content' in schema || 'description' in schema) return schema
  return {
    description: SUCCESS_DESCRIPTIONS[status] ?? 'The request succeeded.',
    content: { 'application/json': { schema } },
  }
}

/**
 * Per-route transform: hide everything that is not the JSON API, then hand the rest to the
 * zod transform and file the result under its resource.
 */
export const openApiTransform: SwaggerTransform = (documentObject) => {
  const { url, route } = documentObject
  if (!isDocumentedRoute(url)) return { schema: { hide: true }, url }

  const transformed = jsonSchemaTransform(documentObject)
  const schema = { ...transformed.schema } as FastifySchema & {
    tags?: readonly string[]
    summary?: string
    response?: Record<string, unknown>
  }

  const tag = tagForRoute(url)
  if (tag !== undefined) schema.tags = [tag]

  const method = typeof route.method === 'string' ? route.method : (route.method[0] ?? 'GET')
  const operation = OPERATIONS[`${method} ${url}`]
  if (operation !== undefined) schema.summary = operation.summary

  const responses: Record<string, unknown> = {}
  for (const [status, declared] of Object.entries(schema.response ?? {})) {
    responses[status] =
      Number(status) < 400 && isPlainObject(declared)
        ? describedSuccess(Number(status), declared)
        : declared
  }
  if (operation?.emptySuccess !== undefined) {
    const { status, description } = operation.emptySuccess
    // `type: 'null'` is how @fastify/swagger says "a response with no body".
    responses[String(status)] ??= { type: 'null', description }
  }
  for (const status of errorStatusesFor(method, url, route.schema)) {
    responses[String(status)] ??= errorResponse(status)
  }
  schema.response = responses

  return { schema, url: transformed.url }
}

/** Document-level transform: the zod components, plus the one error envelope. */
export const openApiTransformObject: SwaggerTransformObject = (documentObject) => {
  const document = jsonSchemaTransformObject(documentObject) as {
    components?: { schemas?: Record<string, unknown> }
  }
  return {
    ...document,
    components: {
      ...document.components,
      schemas: {
        ...document.components?.schemas,
        [API_ERROR_SCHEMA_NAME]: apiErrorComponentSchema(),
      },
    },
  } as ReturnType<SwaggerTransformObject>
}

// The generated document has to stay in step with spec 05 §3: every endpoint it lists, and
// nothing that belongs to the resolver, the health probes, sign-in, or the static files.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIdentityPlugin } from '../auth/plugin.ts'
import { buildTestApp, CANONICAL_ORIGIN } from '../testing/fixtures.ts'
import type { GoLinksApp } from '../types.ts'
import { errorStatusesFor, isDocumentedRoute, tagForRoute } from './document.ts'
import { OPENAPI_CACHE_CONTROL, OPENAPI_PATH } from './plugin.ts'

/** Spec 05 §3, written out so the document is checked against the specification, not itself. */
const SPEC_05_OPERATIONS = [
  'GET /_/api/v1/me',
  'PATCH /_/api/v1/me',
  'GET /_/api/v1/links',
  'POST /_/api/v1/links',
  'GET /_/api/v1/links/suggestions',
  'GET /_/api/v1/links/{id}',
  'PATCH /_/api/v1/links/{id}',
  'DELETE /_/api/v1/links/{id}',
  'POST /_/api/v1/links/{id}/transfers',
  'GET /_/api/v1/transfers/{token}',
  'POST /_/api/v1/transfers/{token}/accept',
  'GET /_/api/v1/admin/users',
  'GET /_/api/v1/admin/users/{id}',
  'PATCH /_/api/v1/admin/users/{id}',
  'GET /_/api/v1/admin/settings',
  'PUT /_/api/v1/admin/settings',
  'GET /_/api/v1/admin/events',
].sort()

/** Paths that exist on the instance and must not reach the document (spec 05 §3, last table). */
const UNDOCUMENTED_PATHS = [
  '/*',
  '/robots.txt',
  '/favicon.ico',
  '/_/health/live',
  '/_/health/ready',
  '/_/opensearch.xml',
  '/_/auth/providers',
  '/_/auth/login',
  '/_/metrics',
  OPENAPI_PATH,
]

interface OpenApiOperation {
  tags?: string[]
  summary?: string
  parameters?: { name: string; in: string; required?: boolean; schema?: Record<string, unknown> }[]
  responses: Record<string, { description?: string; content?: Record<string, { schema: unknown }> }>
}

interface OpenApiDocument {
  openapi: string
  info: { title: string; version: string }
  servers?: { url: string }[]
  tags?: { name: string; description?: string }[]
  paths: Record<string, Record<string, OpenApiOperation>>
  components?: { schemas?: Record<string, Record<string, unknown>> }
}

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options'])

/** Every `METHOD /path` the document declares. */
function operationsOf(document: OpenApiDocument): string[] {
  const operations: string[] = []
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(item)) {
      if (HTTP_METHODS.has(method)) operations.push(`${method.toUpperCase()} ${path}`)
    }
  }
  return operations.sort()
}

function operationAt(document: OpenApiDocument, method: string, path: string): OpenApiOperation {
  const operation = document.paths[path]?.[method.toLowerCase()]
  if (operation === undefined) throw new Error(`The document has no ${method} ${path}.`)
  return operation
}

function jsonBodySchema(operation: OpenApiOperation, status: string): Record<string, unknown> {
  const schema = operation.responses[status]?.content?.['application/json']?.schema
  if (schema === null || typeof schema !== 'object') {
    throw new Error(`No JSON schema on the ${status} response.`)
  }
  return schema as Record<string, unknown>
}

describe('the served OpenAPI document', () => {
  let app: GoLinksApp
  let document: OpenApiDocument
  let body: string

  beforeAll(async () => {
    // The identity plugin brings `/me` with it, and metrics are switched on so that the
    // scrape endpoint is there to be left out.
    app = await buildTestApp({
      environment: { METRICS_ENABLED: 'true' },
      plugins: [createIdentityPlugin()],
    })
    const response = await app.inject({ method: 'GET', url: OPENAPI_PATH })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/json')
    expect(response.headers['cache-control']).toBe(OPENAPI_CACHE_CONTROL)
    body = response.body
    document = JSON.parse(body) as OpenApiDocument
  })

  afterAll(async () => {
    await app.close()
  })

  it('parses as an OpenAPI 3 document naming this service', () => {
    expect(() => JSON.parse(body)).not.toThrow()
    expect(document.openapi.startsWith('3.')).toBe(true)
    expect(document.info.title).toBe('GoLinks API')
    // The version the API package reports, which is what `GET /me` hands the web app.
    expect(document.info.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(document.servers).toEqual([{ url: CANONICAL_ORIGIN }])
  })

  it('lists every endpoint of spec 05 §3 and nothing else', () => {
    expect(operationsOf(document)).toEqual(SPEC_05_OPERATIONS)
  })

  it('leaves out the resolver, health, sign-in, metrics, static files, and itself', () => {
    for (const path of UNDOCUMENTED_PATHS) {
      expect(Object.keys(document.paths)).not.toContain(path)
    }
    for (const path of Object.keys(document.paths)) {
      expect(path.startsWith('/_/api/v1/')).toBe(true)
    }
  })

  it('files every operation under its resource', () => {
    expect(document.tags?.map((tag) => tag.name)).toEqual(['me', 'links', 'transfers', 'admin'])
    for (const tag of document.tags ?? []) {
      expect(tag.description?.length).toBeGreaterThan(0)
    }
    expect(operationAt(document, 'GET', '/_/api/v1/links').tags).toEqual(['links'])
    expect(operationAt(document, 'GET', '/_/api/v1/transfers/{token}').tags).toEqual(['transfers'])
    expect(operationAt(document, 'GET', '/_/api/v1/me').tags).toEqual(['me'])
    expect(operationAt(document, 'GET', '/_/api/v1/admin/events').tags).toEqual(['admin'])
    expect(operationAt(document, 'POST', '/_/api/v1/links').summary).toBe('Create a link.')
  })

  it('documents the query parameters of the link directory', () => {
    const parameters = operationAt(document, 'GET', '/_/api/v1/links').parameters ?? []
    const names = parameters.map((parameter) => parameter.name)
    expect(names).toContain('destination')
    expect(names).toEqual(
      expect.arrayContaining([
        'q',
        'namespace',
        'owner',
        'programmatic',
        'sort',
        'limit',
        'cursor',
      ]),
    )

    const destination = parameters.find((parameter) => parameter.name === 'destination')
    expect(destination?.in).toBe('query')
    expect(destination?.required).toBe(false)
    expect(destination?.schema).toMatchObject({ type: 'string' })
  })

  it('describes the link a creation answers with', () => {
    const created = jsonBodySchema(operationAt(document, 'POST', '/_/api/v1/links'), '201')
    expect(created.type).toBe('object')
    const properties = created.properties as Record<string, unknown>
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining([
        'id',
        'namespace',
        'keyword',
        'displayKeyword',
        'fullPath',
        'destination',
        'isProgrammatic',
        'placeholderCount',
        'isUnlisted',
        'owner',
        'visitCount',
        'lastVisitedAt',
        'createdAt',
        'updatedAt',
        'permissions',
      ]),
    )
  })

  it('describes the body a creation accepts', () => {
    const operation = operationAt(document, 'POST', '/_/api/v1/links') as OpenApiOperation & {
      requestBody?: { content: Record<string, { schema: Record<string, unknown> }> }
    }
    const schema = operation.requestBody?.content['application/json']?.schema
    expect(Object.keys((schema?.properties ?? {}) as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['namespace', 'keyword', 'destination', 'isUnlisted', 'ownerId']),
    )
    expect(schema?.required).toEqual(expect.arrayContaining(['keyword', 'destination']))
  })

  it('answers every failure with the one ApiError component', () => {
    const apiError = document.components?.schemas?.ApiError
    expect(apiError).toBeDefined()
    const envelope = apiError?.properties as Record<string, Record<string, unknown>> | undefined
    const error = envelope?.error as { properties?: Record<string, unknown> } | undefined
    expect(Object.keys(error?.properties ?? {})).toEqual(
      expect.arrayContaining(['code', 'message', 'details', 'existingLink']),
    )

    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item)) {
        if (!HTTP_METHODS.has(method)) continue
        for (const [status, response] of Object.entries(operation.responses)) {
          if (Number(status) < 400) continue
          expect(
            response.content?.['application/json']?.schema,
            `${method.toUpperCase()} ${path} ${status}`,
          ).toEqual({ $ref: '#/components/schemas/ApiError' })
          expect(response.description?.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('gives every operation the errors it can answer with', () => {
    // Reading needs a session; writing is held to the Origin check and the read-only rule as
    // well; an addressed link can be missing; a rename can collide (spec 05 §4).
    expect(Object.keys(operationAt(document, 'GET', '/_/api/v1/me').responses)).toEqual([
      '200',
      '401',
    ])
    expect(Object.keys(operationAt(document, 'PATCH', '/_/api/v1/links/{id}').responses)).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
    ])
    // The delete answers 204 even though its route declares no response schema (spec 05 §3).
    const deletion = operationAt(document, 'DELETE', '/_/api/v1/links/{id}')
    expect(Object.keys(deletion.responses)).toEqual(['204', '401', '403', '404'])
    expect(deletion.responses['204']?.content).toBeUndefined()
  })
})

describe('what belongs in the document', () => {
  it('takes the JSON API and leaves the rest', () => {
    expect(isDocumentedRoute('/_/api/v1/links')).toBe(true)
    expect(isDocumentedRoute('/_/api/v1/admin/users/:id')).toBe(true)
    expect(isDocumentedRoute(OPENAPI_PATH)).toBe(false)
    expect(isDocumentedRoute('/_/api/v2/links')).toBe(false)
    expect(isDocumentedRoute('/_/health/live')).toBe(false)
    expect(isDocumentedRoute('/*')).toBe(false)
  })

  it('reads the resource an operation belongs to from its path', () => {
    expect(tagForRoute('/_/api/v1/links/:id')).toBe('links')
    expect(tagForRoute('/_/api/v1/me')).toBe('me')
    expect(tagForRoute('/_/api/v1/transfers/:token/accept')).toBe('transfers')
    expect(tagForRoute('/_/api/v1/admin/settings')).toBe('admin')
    expect(tagForRoute('/_/api/v1/something-else')).toBeUndefined()
  })

  it('asks for a session everywhere and for the rest only where it applies', () => {
    expect(errorStatusesFor('GET', '/_/api/v1/me', {})).toEqual([401])
    expect(errorStatusesFor('GET', '/_/api/v1/admin/settings', {})).toEqual([401, 403])
    expect(errorStatusesFor('POST', '/_/api/v1/links', { body: {} })).toEqual([400, 401, 403, 409])
  })
})

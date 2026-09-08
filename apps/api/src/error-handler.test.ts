import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ApiError } from './errors.ts'
import { buildTestApp, CANONICAL_ORIGIN } from './testing/fixtures.ts'
import type { GoLinksApp } from './types.ts'

const failingRoutes = (instance: GoLinksApp): void => {
  instance.route({
    method: 'GET',
    url: '/_/test/boom',
    handler: async () => {
      throw new Error('the widget came loose')
    },
  })
  instance.route({
    method: 'GET',
    url: '/_/test/conflict',
    handler: async () => {
      throw new ApiError('keyword_exists', 'go/handbook already exists.', {
        existingLink: { id: '42', fullPath: 'go/handbook' },
      })
    },
  })
  instance.route({
    method: 'POST',
    url: '/_/api/v1/echo',
    schema: { body: z.object({ keyword: z.string().min(3), destination: z.url() }) },
    handler: async () => ({ ok: true }),
  })
}

let app: GoLinksApp | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('error envelope', () => {
  it('answers an unknown path with not_found', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/_/nothing/here' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: expect.any(String) },
    })
  })

  it('reports schema failures as validation_failed with the offending fields', async () => {
    app = await buildTestApp({ plugins: [failingRoutes] })

    const response = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      headers: { origin: CANONICAL_ORIGIN },
      payload: { keyword: 'go', destination: 'not-a-url' },
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body.error.code).toBe('validation_failed')
    expect(Object.keys(body.error.details.fields)).toEqual(
      expect.arrayContaining(['keyword', 'destination']),
    )
  })

  it('hides unexpected failures behind internal_error and names the request id', async () => {
    app = await buildTestApp({ plugins: [failingRoutes] })

    const response = await app.inject({ method: 'GET', url: '/_/test/boom' })

    expect(response.statusCode).toBe(500)
    const body = response.json()
    expect(body.error.code).toBe('internal_error')
    expect(body.error.message).not.toContain('widget')
    expect(body.error.details.requestId).toBe(response.headers['x-request-id'])
  })

  it('carries existingLink through for keyword conflicts', async () => {
    app = await buildTestApp({ plugins: [failingRoutes] })

    const response = await app.inject({ method: 'GET', url: '/_/test/conflict' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      error: {
        code: 'keyword_exists',
        message: 'go/handbook already exists.',
        existingLink: { id: '42', fullPath: 'go/handbook' },
      },
    })
  })

  it('refuses a body larger than the API limit', async () => {
    app = await buildTestApp({ plugins: [failingRoutes] })

    const response = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      headers: { origin: CANONICAL_ORIGIN },
      payload: { keyword: 'x'.repeat(70 * 1024), destination: 'https://example.com' },
    })

    expect(response.statusCode).toBe(413)
    expect(response.json().error.code).toBe('payload_too_large')
  })
})

describe('request id', () => {
  it('generates one and echoes it on every response', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/_/health/live' })

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('ignores a caller supplied id when no proxy is trusted', async () => {
    app = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/_/health/live',
      headers: { 'x-request-id': 'caller-chosen' },
    })

    expect(response.headers['x-request-id']).not.toBe('caller-chosen')
  })

  it('honors the id from a trusted proxy', async () => {
    app = await buildTestApp({ environment: { TRUST_PROXY: 'true' } })

    const response = await app.inject({
      method: 'GET',
      url: '/_/health/live',
      headers: { 'x-request-id': 'edge-42' },
    })

    expect(response.headers['x-request-id']).toBe('edge-42')
  })

  it('discards an id that could forge a header', async () => {
    app = await buildTestApp({ environment: { TRUST_PROXY: 'true' } })

    const response = await app.inject({
      method: 'GET',
      url: '/_/health/live',
      headers: { 'x-request-id': 'a'.repeat(500) },
    })

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })
})

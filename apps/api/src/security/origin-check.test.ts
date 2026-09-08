import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildTestApp, CANONICAL_ORIGIN } from '../testing/fixtures.ts'
import type { GoLinksApp } from '../types.ts'

const echoRoute = (instance: GoLinksApp): void => {
  instance.route({
    method: 'POST',
    url: '/_/api/v1/echo',
    schema: {
      body: z.object({ keyword: z.string().min(1) }),
      response: { 200: z.object({ keyword: z.string() }) },
    },
    handler: async (request) => ({ keyword: request.body.keyword }),
  })
}

let app: GoLinksApp | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('origin check', () => {
  it('accepts a same-origin state-changing request', async () => {
    app = await buildTestApp({ plugins: [echoRoute] })

    const response = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      headers: { origin: CANONICAL_ORIGIN },
      payload: { keyword: 'handbook' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ keyword: 'handbook' })
  })

  it('rejects a cross-origin state-changing request', async () => {
    app = await buildTestApp({ plugins: [echoRoute] })

    const response = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      headers: { origin: 'https://evil.example' },
      payload: { keyword: 'handbook' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('csrf_origin_mismatch')
  })

  it('falls back to the Referer when the browser sent no Origin', async () => {
    app = await buildTestApp({ plugins: [echoRoute] })

    const accepted = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      headers: { referer: `${CANONICAL_ORIGIN}/_/admin/settings` },
      payload: { keyword: 'handbook' },
    })
    expect(accepted.statusCode).toBe(200)

    const refused = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      headers: { referer: 'https://evil.example/page' },
      payload: { keyword: 'handbook' },
    })
    expect(refused.statusCode).toBe(403)
    expect(refused.json().error.code).toBe('csrf_origin_mismatch')
  })

  it('rejects a request that carries neither header', async () => {
    app = await buildTestApp({ plugins: [echoRoute] })

    const response = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      payload: { keyword: 'handbook' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('csrf_origin_mismatch')
  })

  it('leaves reads alone', async () => {
    app = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/_/health/live',
      headers: { origin: 'https://evil.example' },
    })

    expect(response.statusCode).toBe(200)
  })

  it('holds sign-out to the same check, including as a plain link', async () => {
    app = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/_/auth/logout',
      headers: { referer: 'https://evil.example/page' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('csrf_origin_mismatch')
  })

  it('refuses an API body that is not JSON', async () => {
    app = await buildTestApp({ plugins: [echoRoute] })

    const response = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      headers: { origin: CANONICAL_ORIGIN, 'content-type': 'text/plain' },
      payload: 'keyword=handbook',
    })

    expect(response.statusCode).toBe(415)
    expect(response.json().error.code).toBe('unsupported_media_type')
  })

  it('accepts application/json with a charset parameter', async () => {
    app = await buildTestApp({ plugins: [echoRoute] })

    const response = await app.inject({
      method: 'POST',
      url: '/_/api/v1/echo',
      headers: { origin: CANONICAL_ORIGIN, 'content-type': 'application/json; charset=utf-8' },
      payload: JSON.stringify({ keyword: 'handbook' }),
    })

    expect(response.statusCode).toBe(200)
  })
})

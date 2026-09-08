import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/fixtures.ts'
import type { GoLinksApp } from '../types.ts'
import { applyRedirectHeaders, HSTS_HEADER, REFERRER_POLICY } from './headers.ts'

/** The policy exactly as spec 02 §7 writes it. */
const SPEC_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/** Header directives are separated by `;`; comparing them needs one canonical spacing. */
function normalizePolicy(value: string | undefined): string {
  return (value ?? '')
    .split(';')
    .map((directive) => directive.trim())
    .filter((directive) => directive.length > 0)
    .join('; ')
}

let app: GoLinksApp | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('security headers', () => {
  it('sends the content security policy of the specification', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/_/health/live' })

    expect(normalizePolicy(response.headers['content-security-policy'] as string)).toBe(
      SPEC_CONTENT_SECURITY_POLICY,
    )
  })

  it('sends nosniff and a strict referrer policy on every response', async () => {
    app = await buildTestApp()

    // Nobody is signed in, so the resolver sends this one to sign-in (spec 04 §3).
    const response = await app.inject({ method: 'GET', url: '/keyword-that-does-not-exist' })

    expect(response.statusCode).toBe(302)
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['referrer-policy']).toBe(REFERRER_POLICY)
    expect(response.headers['content-security-policy']).toBeDefined()
  })

  it('sends HSTS when the canonical origin is https', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/_/health/live' })

    expect(response.headers['strict-transport-security']).toBe(HSTS_HEADER)
  })

  it('omits HSTS when the canonical origin is plain http', async () => {
    app = await buildTestApp({ environment: { BASE_URL: 'http://localhost:3000' } })

    const response = await app.inject({ method: 'GET', url: '/_/health/live' })

    expect(response.headers['strict-transport-security']).toBeUndefined()
  })

  it('lets a redirect suppress the referrer and any caching', async () => {
    app = await buildTestApp({
      plugins: [
        (instance) => {
          instance.route({
            method: 'GET',
            url: '/_/test/redirect',
            handler: async (_request, reply) =>
              applyRedirectHeaders(reply).redirect('https://docs.example.com/notes', 302),
          })
        },
      ],
    })

    const response = await app.inject({ method: 'GET', url: '/_/test/redirect' })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('https://docs.example.com/notes')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
    expect(response.headers['cache-control']).toBe('no-store')
  })
})

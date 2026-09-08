import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/fixtures.ts'
import type { GoLinksApp } from '../types.ts'
import { rateLimitScope } from './rate-limits.ts'

/** Stands in for the link listing endpoint, which draws on the plain API budget. */
const listRoute = (instance: GoLinksApp): void => {
  instance.route({
    method: 'GET',
    url: '/_/api/v1/links',
    handler: async () => ({ items: [], nextCursor: null }),
  })
}

let app: GoLinksApp | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('rate limits', () => {
  it('assigns each path to the budget that owns it', () => {
    expect(rateLimitScope('/_/api/v1/links')).toBe('api')
    expect(rateLimitScope('/handbook')).toBe('resolver')
    expect(rateLimitScope('/eng/oncall')).toBe('resolver')
    expect(rateLimitScope('/_/health/ready')).toBeUndefined()
    expect(rateLimitScope('/_/auth/login')).toBeUndefined()
    expect(rateLimitScope('/favicon.ico')).toBeUndefined()
    expect(rateLimitScope('/')).toBeUndefined()
  })

  it('answers 429 with Retry-After once the API budget is spent', async () => {
    app = await buildTestApp({ environment: { RATE_LIMIT_API: '2' }, plugins: [listRoute] })

    const first = await app.inject({ method: 'GET', url: '/_/api/v1/links' })
    const second = await app.inject({ method: 'GET', url: '/_/api/v1/links' })
    const third = await app.inject({ method: 'GET', url: '/_/api/v1/links' })

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(200)
    expect(third.statusCode).toBe(429)
    expect(third.json()).toEqual({
      error: { code: 'rate_limited', message: expect.any(String), details: expect.any(Object) },
    })
    expect(Number(third.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('limits the resolver separately from the API', async () => {
    app = await buildTestApp({
      environment: { RATE_LIMIT_API: '1', RATE_LIMIT_RESOLVER: '3' },
      plugins: [listRoute],
    })

    await app.inject({ method: 'GET', url: '/_/api/v1/links' })
    const apiExceeded = await app.inject({ method: 'GET', url: '/_/api/v1/links' })
    expect(apiExceeded.statusCode).toBe(429)

    // The resolver budget is untouched by the API traffic above. Nobody is signed in, so
    // each keyword is answered with the redirect to sign-in (spec 04 §3).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: `/handbook-${attempt}` })
      expect(response.statusCode).toBe(302)
    }
    const resolverExceeded = await app.inject({ method: 'GET', url: '/handbook-4' })
    expect(resolverExceeded.statusCode).toBe(429)
  })

  it('counts an API caller by session rather than by address', async () => {
    app = await buildTestApp({ environment: { RATE_LIMIT_API: '1' }, plugins: [listRoute] })

    const anonymous = await app.inject({ method: 'GET', url: '/_/api/v1/links' })
    expect(anonymous.statusCode).toBe(200)

    // A session is its own subject even though the address has already spent its budget.
    const withSession = await app.inject({
      method: 'GET',
      url: '/_/api/v1/links',
      headers: { cookie: 'gl_session=some-session-id' },
    })
    expect(withSession.statusCode).toBe(200)

    const sameSessionAgain = await app.inject({
      method: 'GET',
      url: '/_/api/v1/links',
      headers: { cookie: 'gl_session=some-session-id' },
    })
    expect(sameSessionAgain.statusCode).toBe(429)
  })

  it('lets the subject resolver be replaced once sessions are loaded per request', async () => {
    app = await buildTestApp({ environment: { RATE_LIMIT_API: '1' }, plugins: [listRoute] })
    app.setRateLimitSubjectResolver(() => 'member:7')

    expect((await app.inject({ method: 'GET', url: '/_/api/v1/links' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/_/api/v1/links' })).statusCode).toBe(429)
  })

  it('publishes a tighter budget for link creation', async () => {
    app = await buildTestApp()

    expect(app.rateLimits.linkCreate.max).toBe(60)
    expect(app.rateLimits.api.max).toBe(600)
    expect(app.rateLimits.resolver.max).toBe(1200)
  })

  it('can be switched off entirely', async () => {
    app = await buildTestApp({
      environment: { RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_API: '1' },
      plugins: [listRoute],
    })

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: '/_/api/v1/links' })
      expect(response.statusCode).toBe(200)
    }
  })
})

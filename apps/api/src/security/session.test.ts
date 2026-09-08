import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/fixtures.ts'
import type { GoLinksApp } from '../types.ts'
import { createMemorySessionStore } from './session.ts'

/** Stands in for the sign-in callback, which is the only place that opens a session. */
const signInRoute = (instance: GoLinksApp): void => {
  instance.route({
    method: 'GET',
    url: '/_/test/sign-in',
    handler: async (request, reply) => {
      request.session.set('userId', '7')
      return reply.send({ ok: true })
    },
  })
}

function attributesOf(setCookie: string | string[] | undefined): string[] {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return (header ?? '').split(';').map((part) => part.trim())
}

let app: GoLinksApp | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('session cookie policy', () => {
  it('writes a host-only, HttpOnly, Secure, SameSite=Lax cookie named gl_session', async () => {
    // A Secure cookie is only written over TLS, which behind a proxy means a forwarded scheme.
    app = await buildTestApp({ environment: { TRUST_PROXY: 'true' }, plugins: [signInRoute] })

    const response = await app.inject({
      method: 'GET',
      url: '/_/test/sign-in',
      headers: { 'x-forwarded-proto': 'https' },
    })
    const attributes = attributesOf(response.headers['set-cookie'])

    expect(attributes[0]).toMatch(/^gl_session=/)
    expect(attributes).toContain('Path=/')
    expect(attributes).toContain('HttpOnly')
    expect(attributes).toContain('Secure')
    expect(attributes).toContain('SameSite=Lax')
    expect(attributes.some((attribute) => attribute.startsWith('Domain='))).toBe(false)
  })

  it('drops Secure only for a plain-http loopback deployment', async () => {
    app = await buildTestApp({
      environment: { BASE_URL: 'http://localhost:3000' },
      plugins: [signInRoute],
    })

    const response = await app.inject({ method: 'GET', url: '/_/test/sign-in' })

    expect(attributesOf(response.headers['set-cookie'])).not.toContain('Secure')
  })

  it('sets no cookie for a request that never opens a session', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/_/health/live' })

    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('keeps session data in the store that was handed to it', async () => {
    const store = createMemorySessionStore()
    app = await buildTestApp({
      environment: { BASE_URL: 'http://localhost:3000' },
      sessionStore: store,
      plugins: [signInRoute],
    })

    expect(store.size()).toBe(0)
    await app.inject({ method: 'GET', url: '/_/test/sign-in' })
    expect(store.size()).toBe(1)
  })
})

describe('memory session store', () => {
  it('returns nothing for an unknown session', async () => {
    const store = createMemorySessionStore()

    const session = await new Promise((resolve, reject) => {
      store.get('missing', (error, value) => (error ? reject(error) : resolve(value)))
    })

    expect(session).toBeNull()
  })

  it('forgets a session once its cookie has expired', async () => {
    let now = 1_000
    const store = createMemorySessionStore(() => now)
    const session = { cookie: { originalMaxAge: 5_000, maxAge: 5_000 } }

    await new Promise<void>((resolve) => store.set('abc', session, () => resolve()))
    now += 6_000

    const found = await new Promise((resolve, reject) => {
      store.get('abc', (error, value) => (error ? reject(error) : resolve(value)))
    })

    expect(found).toBeNull()
    expect(store.size()).toBe(0)
  })

  it('destroys a session on request', async () => {
    const store = createMemorySessionStore()
    const session = { cookie: { originalMaxAge: null } }

    await new Promise<void>((resolve) => store.set('abc', session, () => resolve()))
    expect(store.size()).toBe(1)

    await new Promise<void>((resolve) => store.destroy('abc', () => resolve()))
    expect(store.size()).toBe(0)
  })
})

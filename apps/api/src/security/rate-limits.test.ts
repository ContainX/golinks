import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildTestApp } from '../testing/fixtures.ts'
import type { GoLinksApp } from '../types.ts'
import {
  createFailOpenRateLimitStore,
  createLocalRateLimitCounters,
  decodeRateLimitCount,
  type RateLimitCount,
  type RateLimitCounterStore,
  type RateLimitRedisClient,
  rateLimitScope,
} from './rate-limits.ts'

/**
 * A route of the suite's own that draws on the plain API budget. Deliberately not one of the
 * service's real endpoints: what is being measured is the budget, not the handler.
 */
const PROBE_PATH = '/_/api/v1/rate-limit-probe'

const probeRoute = (instance: GoLinksApp): void => {
  instance.route({
    method: 'GET',
    url: PROBE_PATH,
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
    app = await buildTestApp({ environment: { RATE_LIMIT_API: '2' }, plugins: [probeRoute] })

    const first = await app.inject({ method: 'GET', url: PROBE_PATH })
    const second = await app.inject({ method: 'GET', url: PROBE_PATH })
    const third = await app.inject({ method: 'GET', url: PROBE_PATH })

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
      plugins: [probeRoute],
    })

    await app.inject({ method: 'GET', url: PROBE_PATH })
    const apiExceeded = await app.inject({ method: 'GET', url: PROBE_PATH })
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
    app = await buildTestApp({ environment: { RATE_LIMIT_API: '1' }, plugins: [probeRoute] })

    const anonymous = await app.inject({ method: 'GET', url: PROBE_PATH })
    expect(anonymous.statusCode).toBe(200)

    // A session is its own subject even though the address has already spent its budget.
    const withSession = await app.inject({
      method: 'GET',
      url: PROBE_PATH,
      headers: { cookie: 'gl_session=some-session-id' },
    })
    expect(withSession.statusCode).toBe(200)

    const sameSessionAgain = await app.inject({
      method: 'GET',
      url: PROBE_PATH,
      headers: { cookie: 'gl_session=some-session-id' },
    })
    expect(sameSessionAgain.statusCode).toBe(429)
  })

  it('lets the subject resolver be replaced once sessions are loaded per request', async () => {
    app = await buildTestApp({ environment: { RATE_LIMIT_API: '1' }, plugins: [probeRoute] })
    app.setRateLimitSubjectResolver(() => 'member:7')

    expect((await app.inject({ method: 'GET', url: PROBE_PATH })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: PROBE_PATH })).statusCode).toBe(429)
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
      plugins: [probeRoute],
    })

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: PROBE_PATH })
      expect(response.statusCode).toBe(200)
    }
  })
})

// --- the counters underneath ------------------------------------------------

/** Counts a fixed window in memory, standing in for a Redis that answers. */
function answeringRedis(): RateLimitRedisClient & { calls: number } {
  const windows = new Map<string, number>()
  const client = {
    calls: 0,
    async eval(script: string, _numberOfKeys: number, key: string | number, ttl?: string | number) {
      client.calls += 1
      const name = String(key)
      if (!script.includes('INCR')) return [windows.get(name) ?? 0, 0]
      const next = (windows.get(name) ?? 0) + 1
      windows.set(name, next)
      return [next, Number(ttl ?? 0)]
    },
  }
  return client
}

/** A Redis that rejects every command, the way ioredis does with the socket down. */
function unreachableRedis(): RateLimitRedisClient {
  return {
    async eval() {
      throw new Error("Stream isn't writeable and enableOfflineQueue options is false")
    },
  }
}

/** Drives a store's `incr` as the plugin does, as a promise. */
function increment(
  store: RateLimitCounterStore,
  key: string,
  timeWindowMs = 60_000,
  max = 5,
): Promise<RateLimitCount | undefined> {
  return new Promise((resolve, reject) => {
    store.incr(
      key,
      (error, count) => (error === null ? resolve(count) : reject(error)),
      timeWindowMs,
      max,
    )
  })
}

describe('in-process counters', () => {
  it('counts a fixed window and starts a new one when it lapses', () => {
    let now = 1_000
    const counters = createLocalRateLimitCounters(() => now)

    expect(counters.incr('a', 100)).toEqual({ current: 1, ttl: 100 })
    now = 1_040
    expect(counters.incr('a', 100)).toEqual({ current: 2, ttl: 60 })
    expect(counters.read('a', 100)).toEqual({ current: 2, ttl: 60 })

    now = 1_200
    expect(counters.incr('a', 100)).toEqual({ current: 1, ttl: 100 })
    expect(counters.read('b', 100)).toEqual({ current: 0, ttl: 0 })
  })
})

describe('shared counter decoding', () => {
  it('accepts the pair the script returns and refuses anything else', () => {
    expect(decodeRateLimitCount([3, 250])).toEqual({ current: 3, ttl: 250 })
    expect(() => decodeRateLimitCount(null)).toThrow()
    expect(() => decodeRateLimitCount([1])).toThrow()
    expect(() => decodeRateLimitCount(['x', 'y'])).toThrow()
  })
})

describe('fail-open counter store', () => {
  it('counts in Redis while Redis answers', async () => {
    const redis = answeringRedis()
    const Store = createFailOpenRateLimitStore({
      redis,
      logger: { info: vi.fn(), warn: vi.fn() },
    })
    const store = new Store({})

    await expect(increment(store, 'api:ip:203.0.113.4')).resolves.toEqual({
      current: 1,
      ttl: 60_000,
    })
    await expect(increment(store, 'api:ip:203.0.113.4')).resolves.toMatchObject({ current: 2 })
    expect(redis.calls).toBe(2)
  })

  it('falls back to counting in this process, warning once for the whole outage', async () => {
    const warn = vi.fn()
    const Store = createFailOpenRateLimitStore({
      redis: unreachableRedis(),
      logger: { info: vi.fn(), warn },
    })
    const store = new Store({})

    await expect(increment(store, 'api:ip:203.0.113.4')).resolves.toMatchObject({ current: 1 })
    await expect(increment(store, 'api:ip:203.0.113.4')).resolves.toMatchObject({ current: 2 })
    await expect(increment(store, 'api:ip:203.0.113.5')).resolves.toMatchObject({ current: 1 })

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('says so once when Redis answers again, and shares the outage with its children', async () => {
    const info = vi.fn()
    const warn = vi.fn()
    let reachable = false
    const redis: RateLimitRedisClient = {
      async eval() {
        if (!reachable) throw new Error('down')
        return [1, 60_000]
      },
    }
    const Store = createFailOpenRateLimitStore({ redis, logger: { info, warn } })
    const store = new Store({})
    const child = store.child({ routeInfo: { method: 'GET', url: '/*' } })

    await increment(store, 'api:ip:1')
    // The child is a separate store, but the outage it reports is the same one.
    await increment(child, 'resolver:ip:1')
    expect(warn).toHaveBeenCalledTimes(1)

    reachable = true
    await increment(child, 'resolver:ip:1')
    expect(info).toHaveBeenCalledTimes(1)
  })

  it('gives each route its own keys', async () => {
    const redis = answeringRedis()
    const seen: string[] = []
    const spying: RateLimitRedisClient = {
      async eval(script, numberOfKeys, key, ...rest) {
        seen.push(String(key))
        return redis.eval(script, numberOfKeys, key, ...rest)
      },
    }
    const Store = createFailOpenRateLimitStore({
      redis: spying,
      logger: { info: vi.fn(), warn: vi.fn() },
    })
    const store = new Store({})

    await increment(store, 'api:ip:1')
    await increment(store.child({ routeInfo: { method: 'GET', url: '/*' } }), 'api:ip:1')

    expect(seen[0]).toBe('rate-limit:api:ip:1')
    expect(seen[1]).toBe('rate-limit:GET/*:api:ip:1')
  })
})

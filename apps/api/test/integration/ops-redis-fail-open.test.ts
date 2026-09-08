// What happens when REDIS_URL points at a Redis that is not there (spec 09 §5, §6).
//
// Redis is optional infrastructure: it holds counters and cached copies of things Postgres
// already knows, plus sessions. Losing it must cost throughput and precision, never
// availability — so rate limiting and the settings cache fall back to this process and log once,
// while sessions stay strict because a session is the one thing Postgres does not have a copy
// of when Redis is where they live.

import { Redis } from 'ioredis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRedisSessionStore, type SessionRedisClient } from '../../src/auth/session-stores.ts'
import { createRedisSettingsCache } from '../../src/organizations/settings-cache.ts'
import { createOrganizationSettingsService } from '../../src/organizations/settings-service.ts'
import { runReadinessChecks } from '../../src/routes/health.ts'
import { buildTestApp, testConfig } from '../../src/testing/fixtures.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertOrganization, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets

/** A port nothing listens on, so every connection attempt is refused at once. */
const UNREACHABLE_REDIS_URL = 'redis://127.0.0.1:6399'

const PROBE_PATH = '/_/api/v1/fail-open-probe'

/** Collects the JSON lines an app writes, so a test can count what was said and how often. */
function captureLog(): {
  lines: Record<string, unknown>[]
  stream: { write(chunk: string): void }
} {
  const lines: Record<string, unknown>[] = []
  return {
    lines,
    stream: {
      write(chunk: string) {
        lines.push(JSON.parse(chunk) as Record<string, unknown>)
      },
    },
  }
}

function messagesMatching(lines: Record<string, unknown>[], fragment: string): unknown[] {
  return lines.filter((line) => String(line.msg ?? '').includes(fragment))
}

let app: GoLinksApp | undefined
let clients: Redis[] = []

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
  for (const client of clients) client.disconnect()
  clients = []
})

/** An ioredis client aimed at nothing, with the short leash a deployment gives it. */
function unreachableClient(): Redis {
  const client = new Redis(UNREACHABLE_REDIS_URL, {
    connectTimeout: 300,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  })
  // Every connection attempt fails; the point of this suite is that nothing else notices.
  client.on('error', () => {})
  clients.push(client)
  return client
}

describe('rate limiting with Redis unreachable', () => {
  it('keeps answering, counts in this process, and warns once for the outage', async () => {
    const log = captureLog()
    app = await buildTestApp({
      environment: { REDIS_URL: UNREACHABLE_REDIS_URL, RATE_LIMIT_API: '2' },
      database: database().db,
      logger: { level: 'info', stream: log.stream },
      plugins: [
        (instance) => {
          instance.get(PROBE_PATH, async () => ({ ok: true }))
        },
      ],
    })

    const statuses: number[] = []
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({ method: 'GET', url: PROBE_PATH })
      statuses.push(response.statusCode)
    }

    // The budget of two is still enforced, and nothing answered 500.
    expect(statuses).toEqual([200, 200, 429, 429, 429])

    const warnings = messagesMatching(log.lines, 'rate limit counters are unreachable')
    expect(warnings).toHaveLength(1)
  })

  it('leaves the resolver answering for a member who is not signed in', async () => {
    app = await buildTestApp({
      environment: { REDIS_URL: UNREACHABLE_REDIS_URL },
      database: database().db,
    })

    const response = await app.inject({ method: 'GET', url: '/handbook' })
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toContain('/_/auth/login')
  })
})

describe('the settings cache with Redis unreachable', () => {
  it('reads through to the database and warns once', async () => {
    await insertOrganization(database().db, ORG)

    const warnings: string[] = []
    const service = createOrganizationSettingsService(database().db, {
      cacheTtlMs: 0,
      logger: { warn: (_context, message) => warnings.push(message) },
      sharedCache: createRedisSettingsCache(unreachableClient(), {
        logger: {
          info: () => {},
          warn: (_context, message) => warnings.push(message),
        },
      }),
    })

    // Three reads with the in-process cache switched off, so each one asks the shared cache.
    await expect(service.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'go' })
    await expect(service.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'go' })
    await service.saveSettings(ORG, { defaultNamespace: 'links' })
    await expect(service.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'links' })

    expect(warnings.filter((line) => line.includes('shared organization settings cache'))).toEqual([
      'the shared organization settings cache is unreachable; reading through to the database',
    ])
  })
})

describe('sessions with Redis unreachable', () => {
  it('never hands back a session, so nobody is signed in on the strength of an outage', async () => {
    const store = createRedisSessionStore(unreachableClient() as unknown as SessionRedisClient, {
      maxAgeMs: 2_592_000_000,
    })

    const outcome = await new Promise<{ error: unknown; session: unknown }>((resolve) => {
      store.get('some-session-id', (error, session) => resolve({ error, session }))
    })

    expect(outcome.session).toBeFalsy()
    expect(outcome.error).toBeInstanceOf(Error)
  })

  it('reports Redis as down on the readiness endpoint', async () => {
    const client = unreachableClient()
    app = await buildTestApp({
      environment: { REDIS_URL: UNREACHABLE_REDIS_URL },
      database: database().db,
      readinessChecks: [
        {
          name: 'redis',
          check: async () => {
            await client.ping()
          },
        },
      ],
    })

    const response = await app.inject({ method: 'GET', url: '/_/health/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ status: 'unavailable', failed: ['redis'] })
  })

  it('treats a session Redis simply has no key for as unauthenticated', async () => {
    const empty: SessionRedisClient = {
      async get() {
        return null
      },
      async set() {
        return 'OK'
      },
      async del() {
        return 1
      },
    }
    const store = createRedisSessionStore(empty, { maxAgeMs: 2_592_000_000 })

    const outcome = await new Promise<{ error: unknown; session: unknown }>((resolve) => {
      store.get('some-session-id', (error, session) => resolve({ error, session }))
    })

    expect(outcome.error).toBeNull()
    expect(outcome.session).toBeNull()
  })
})

describe('the readiness report itself', () => {
  it('names every dependency that did not answer', async () => {
    const report = await runReadinessChecks([
      { name: 'postgres', check: async () => {} },
      {
        name: 'redis',
        check: async () => {
          throw new Error('connect ECONNREFUSED')
        },
      },
    ])

    expect(report).toMatchObject({ status: 'unavailable', failed: ['redis'] })
    expect(report.checks).toContainEqual({ name: 'postgres', status: 'up' })
  })
})

describe('the deployment configuration this suite stands on', () => {
  it('reads REDIS_URL as configured even when nothing answers there', () => {
    expect(testConfig({ REDIS_URL: UNREACHABLE_REDIS_URL }).redisUrl).toBe(UNREACHABLE_REDIS_URL)
  })
})

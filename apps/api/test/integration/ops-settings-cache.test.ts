// The shared settings cache in front of a real database (spec 06 §4, spec 04 §11).
//
// Two settings services over one database and one shared cache stand in for two replicas. What
// has to be true is that a write on one of them is not still being served by the other five
// minutes later: the write deletes the shared copy, so the second replica reloads as soon as its
// own thirty-second window lapses.
//
// The propagation cases run against the in-process shared cache, which is the same codec and
// the same interface. The cases below them run only when a Redis answers — REDIS_URL or
// GOLINKS_TEST_REDIS_URL — and pin down the parts that are Redis's own: the key and its
// five-minute expiry.

import type { Redis } from 'ioredis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from '../../src/db/client.ts'
import {
  createMemorySettingsCache,
  createRedisSettingsCache,
  type SettingsRedisClient,
  SHARED_SETTINGS_CACHE_TTL_MS,
  type SharedSettingsCache,
  settingsCacheKey,
} from '../../src/organizations/settings-cache.ts'
import { createOrganizationSettingsService } from '../../src/organizations/settings-service.ts'
import { insertOrganization, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const REDIS_URL = process.env.GOLINKS_TEST_REDIS_URL ?? process.env.REDIS_URL

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets

/** A handle that fails loudly, so a read which should not reach the database is unmistakable. */
const refusingDatabase = new Proxy({} as Database, {
  get() {
    throw new Error('This replica should have been answered from the shared cache.')
  },
})

/** The propagation contract, exercised against whichever shared cache is handed in. */
function describePropagation(name: string, cacheOf: () => SharedSettingsCache): void {
  describe(`settings propagation through ${name}`, () => {
    it('serves a second replica from the shared copy instead of the database', async () => {
      await insertOrganization(database().db, ORG)
      const cache = cacheOf()

      const first = createOrganizationSettingsService(database().db, {
        cacheTtlMs: 0,
        sharedCache: cache,
      })
      await first.saveSettings(ORG, { defaultNamespace: 'go', namespaces: ['eng'] })
      await first.getSettings(ORG)

      const second = createOrganizationSettingsService(refusingDatabase, {
        cacheTtlMs: 0,
        sharedCache: cache,
      })
      await expect(second.getSettings(ORG)).resolves.toMatchObject({ namespaces: ['eng'] })
    })

    it('drops the shared copy on a write, so another replica picks the change up', async () => {
      await insertOrganization(database().db, ORG)
      const cache = cacheOf()

      const writer = createOrganizationSettingsService(database().db, {
        cacheTtlMs: 0,
        sharedCache: cache,
      })
      const reader = createOrganizationSettingsService(database().db, {
        cacheTtlMs: 0,
        sharedCache: cache,
      })

      await writer.saveSettings(ORG, { defaultNamespace: 'go' })
      await expect(reader.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'go' })

      await writer.saveSettings(ORG, { defaultNamespace: 'links' })
      await expect(cache.read(ORG)).resolves.toBeUndefined()
      await expect(reader.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'links' })
    })

    it('keeps a change invisible for no longer than the in-process window', async () => {
      await insertOrganization(database().db, ORG)
      const cache = cacheOf()

      let now = 1_000
      const writer = createOrganizationSettingsService(database().db, { sharedCache: cache })
      const reader = createOrganizationSettingsService(database().db, {
        sharedCache: cache,
        now: () => now,
      })

      await writer.saveSettings(ORG, { defaultNamespace: 'go' })
      await expect(reader.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'go' })

      await writer.saveSettings(ORG, { defaultNamespace: 'links' })
      // Still inside the reader's thirty seconds: it is entitled to the copy it holds.
      await expect(reader.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'go' })

      now += 30_001
      await expect(reader.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'links' })
    })

    it('leaves a replica with no shared cache reading straight from the database', async () => {
      await insertOrganization(database().db, ORG)
      const cache = cacheOf()

      const writer = createOrganizationSettingsService(database().db, { sharedCache: cache })
      await writer.saveSettings(ORG, { defaultNamespace: 'links' })

      const alone = createOrganizationSettingsService(database().db, { cacheTtlMs: 0 })
      await expect(alone.getSettings(ORG)).resolves.toMatchObject({ defaultNamespace: 'links' })
    })
  })
}

let redis: Redis | undefined

/** Opens a client and pings it; anything that does not answer leaves the Redis cases skipped. */
async function openRedis(): Promise<Redis | undefined> {
  if (REDIS_URL === undefined || REDIS_URL.trim().length === 0) return undefined

  const { Redis: RedisClient } = await import('ioredis')
  const client = new RedisClient(REDIS_URL, {
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  })
  client.on('error', () => {})

  try {
    await client.connect()
    await client.ping()
    return client
  } catch {
    client.disconnect()
    return undefined
  }
}

beforeAll(async () => {
  redis = await openRedis()
})

afterAll(() => {
  redis?.disconnect()
  redis = undefined
})

beforeEach(async () => {
  await resetDatabase()
  if (redis !== undefined) await redis.del(settingsCacheKey(ORG))
})

describePropagation('the in-process shared cache', () => createMemorySettingsCache())

describe.skipIf(REDIS_URL === undefined)('the shared settings cache over a real Redis', () => {
  it('holds one key per organization for five minutes', async () => {
    const client = redis
    // Nothing answered where REDIS_URL points, so there is nothing to assert against.
    if (client === undefined) return

    const service = createOrganizationSettingsService(database().db, {
      cacheTtlMs: 0,
      sharedCache: createRedisSettingsCache(client as unknown as SettingsRedisClient),
    })

    await insertOrganization(database().db, ORG)
    await service.getSettings(ORG)

    const ttl = await client.pttl(settingsCacheKey(ORG))
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(SHARED_SETTINGS_CACHE_TTL_MS)
  })

  it('removes the key outright when a write invalidates it', async () => {
    const client = redis
    if (client === undefined) return

    const service = createOrganizationSettingsService(database().db, {
      cacheTtlMs: 0,
      sharedCache: createRedisSettingsCache(client as unknown as SettingsRedisClient),
    })

    await insertOrganization(database().db, ORG)
    await service.getSettings(ORG)
    expect(await client.exists(settingsCacheKey(ORG))).toBe(1)

    await service.saveSettings(ORG, { defaultNamespace: 'links' })
    expect(await client.exists(settingsCacheKey(ORG))).toBe(0)
  })
})

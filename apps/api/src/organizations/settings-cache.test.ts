import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import { describe, expect, it, vi } from 'vitest'
import {
  createMemorySettingsCache,
  createRedisSettingsCache,
  decodeSettings,
  encodeSettings,
  type SettingsRedisClient,
  SHARED_SETTINGS_CACHE_TTL_MS,
  settingsCacheKey,
} from './settings-cache.ts'

const ORG = 'widgets.test'
const SETTINGS = { ...DEFAULT_ORGANIZATION_SETTINGS, namespaces: ['eng'] }

/** A Redis stand-in with one entry, so a test can watch the key, the value, and the TTL. */
function fakeRedis(): SettingsRedisClient & {
  entries: Map<string, { value: string; ttl: number }>
} {
  const entries = new Map<string, { value: string; ttl: number }>()
  return {
    entries,
    async get(key) {
      return entries.get(key)?.value ?? null
    },
    async set(key, value, _mode, ttlMs) {
      entries.set(key, { value, ttl: ttlMs })
    },
    async del(key) {
      entries.delete(key)
    },
  }
}

/** A Redis that has stopped answering. */
function brokenRedis(): SettingsRedisClient {
  const fail = async (): Promise<never> => {
    throw new Error('Stream isn’t writeable')
  }
  return { get: fail, set: fail, del: fail }
}

describe('settings cache codec', () => {
  it('round-trips a settings document', () => {
    expect(decodeSettings(encodeSettings(SETTINGS))).toEqual(SETTINGS)
  })

  it('reads an empty, absent, or unparsable value as a miss', () => {
    expect(decodeSettings(null)).toBeUndefined()
    expect(decodeSettings(undefined)).toBeUndefined()
    expect(decodeSettings('')).toBeUndefined()
    expect(decodeSettings('{ not json')).toBeUndefined()
  })

  it('reads a document that no longer validates as a miss rather than trusting it', () => {
    expect(decodeSettings(JSON.stringify({ defaultNamespace: 42 }))).toBeUndefined()
    expect(decodeSettings(JSON.stringify('a string'))).toBeUndefined()
  })

  it('fills a partial stored document with the defaults', () => {
    const decoded = decodeSettings(JSON.stringify({ defaultNamespace: 'links' }))
    expect(decoded?.defaultNamespace).toBe('links')
    expect(decoded?.keywords).toEqual(DEFAULT_ORGANIZATION_SETTINGS.keywords)
  })

  it('names the key per organization', () => {
    expect(settingsCacheKey(ORG)).toBe('org-settings:widgets.test')
  })
})

describe('redis settings cache', () => {
  it('writes with the five-minute lifetime of spec 06 §4 and reads back', async () => {
    const redis = fakeRedis()
    const cache = createRedisSettingsCache(redis)

    await cache.write(ORG, SETTINGS)
    expect(redis.entries.get(settingsCacheKey(ORG))?.ttl).toBe(SHARED_SETTINGS_CACHE_TTL_MS)
    await expect(cache.read(ORG)).resolves.toEqual(SETTINGS)
  })

  it('drops the shared copy so the next reader goes to the database', async () => {
    const redis = fakeRedis()
    const cache = createRedisSettingsCache(redis)

    await cache.write(ORG, SETTINGS)
    await cache.drop(ORG)

    expect(redis.entries.size).toBe(0)
    await expect(cache.read(ORG)).resolves.toBeUndefined()
  })

  it('reads as a miss when Redis is unreachable, warning once for the outage', async () => {
    const warn = vi.fn()
    const cache = createRedisSettingsCache(brokenRedis(), { logger: { warn, info: vi.fn() } })

    await expect(cache.read(ORG)).resolves.toBeUndefined()
    await expect(cache.read(ORG)).resolves.toBeUndefined()
    await expect(cache.write(ORG, SETTINGS)).resolves.toBeUndefined()
    await expect(cache.drop(ORG)).resolves.toBeUndefined()

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('says so once when Redis starts answering again', async () => {
    const info = vi.fn()
    const warn = vi.fn()
    let broken = true
    const flaky: SettingsRedisClient = {
      async get(key) {
        if (broken) throw new Error('down')
        return fakeStore.get(key) ?? null
      },
      async set(key, value) {
        if (broken) throw new Error('down')
        fakeStore.set(key, value)
      },
      async del(key) {
        if (broken) throw new Error('down')
        fakeStore.delete(key)
      },
    }
    const fakeStore = new Map<string, string>()
    const cache = createRedisSettingsCache(flaky, { logger: { warn, info } })

    await cache.read(ORG)
    broken = false
    await cache.write(ORG, SETTINGS)
    await cache.read(ORG)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledTimes(1)
  })
})

describe('in-process shared cache', () => {
  it('behaves like the Redis one, through the same codec', async () => {
    const cache = createMemorySettingsCache()

    await expect(cache.read(ORG)).resolves.toBeUndefined()
    await cache.write(ORG, SETTINGS)
    await expect(cache.read(ORG)).resolves.toEqual(SETTINGS)
    await cache.drop(ORG)
    expect(cache.size()).toBe(0)
  })
})

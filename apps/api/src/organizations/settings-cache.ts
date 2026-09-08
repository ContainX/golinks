// The shared half of the organization settings cache (spec 06 §4, spec 04 §11).
//
// Settings are read on every resolver and API request. The settings service keeps them in
// process for thirty seconds; this is the layer underneath it, holding the same document in
// Redis for five minutes so that a replica whose in-process copy has just lapsed answers from
// Redis instead of the database. A write deletes the shared copy, so the change reaches every
// other replica within their thirty-second window rather than within five minutes.
//
// Nothing here is a source of truth: the database is. A Redis that stops answering therefore
// costs a few more queries and nothing else, which is why every operation fails open and one
// warning is logged per outage rather than one per request.

import { type OrganizationSettings, parseOrganizationSettings } from '@golinks/shared/settings'

/** Every settings key in Redis is `org-settings:<organization id>`. */
export const SETTINGS_KEY_PREFIX = 'org-settings:'

/** Spec 06 §4: five minutes in Redis. */
export const SHARED_SETTINGS_CACHE_TTL_MS = 300_000

/** The key one organization's document is held under. */
export function settingsCacheKey(organizationId: string): string {
  return `${SETTINGS_KEY_PREFIX}${organizationId}`
}

/**
 * A cache the replicas share. Every method fails soft: a read that cannot be served answers
 * `undefined` and the caller goes to the database, and a write or a drop that cannot be applied
 * leaves the shared copy to expire on its own.
 */
export interface SharedSettingsCache {
  read(organizationId: string): Promise<OrganizationSettings | undefined>
  write(organizationId: string, settings: OrganizationSettings): Promise<void>
  /** Removes the shared copy, which is what a save does. */
  drop(organizationId: string): Promise<void>
}

/** The slice of an ioredis client this cache uses. */
export interface SettingsRedisClient {
  get(key: string): Promise<string | null>
  set(key: string, value: string, mode: 'PX', ttlMs: number): Promise<unknown>
  del(key: string): Promise<unknown>
}

export interface SharedSettingsCacheLogger {
  info(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
}

// --- codec ------------------------------------------------------------------

/** The stored form of a settings document. */
export function encodeSettings(settings: OrganizationSettings): string {
  return JSON.stringify(settings)
}

/**
 * The document a stored value stands for, or undefined when there is nothing usable there.
 *
 * The value is validated on the way back rather than trusted: a shared cache outlives a
 * deployment, so a document written by an older version has to read as a miss instead of as a
 * settings document with the wrong shape.
 */
export function decodeSettings(value: string | null | undefined): OrganizationSettings | undefined {
  if (value === null || value === undefined || value.length === 0) return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return undefined
  }

  const result = parseOrganizationSettings(parsed)
  return result.ok ? result.settings : undefined
}

// --- implementations --------------------------------------------------------

export interface RedisSettingsCacheOptions {
  logger?: SharedSettingsCacheLogger
  /** How long the shared copy lives, in milliseconds. */
  ttlMs?: number
}

/**
 * The Redis-backed cache. One key per organization, five minutes by default, dropped on write.
 */
export function createRedisSettingsCache(
  redis: SettingsRedisClient,
  options: RedisSettingsCacheOptions = {},
): SharedSettingsCache {
  const ttlMs = options.ttlMs ?? SHARED_SETTINGS_CACHE_TTL_MS
  const logger = options.logger
  let isDown = false

  function reportDown(error: unknown, operation: string): void {
    if (isDown) return
    isDown = true
    logger?.warn(
      { err: error, operation },
      'the shared organization settings cache is unreachable; reading through to the database',
    )
  }

  function reportUp(): void {
    if (!isDown) return
    isDown = false
    logger?.info({}, 'the shared organization settings cache is answering again')
  }

  return {
    async read(organizationId) {
      try {
        const value = await redis.get(settingsCacheKey(organizationId))
        reportUp()
        return decodeSettings(value)
      } catch (error) {
        reportDown(error, 'read')
        return undefined
      }
    },

    async write(organizationId, settings) {
      try {
        await redis.set(settingsCacheKey(organizationId), encodeSettings(settings), 'PX', ttlMs)
        reportUp()
      } catch (error) {
        reportDown(error, 'write')
      }
    },

    async drop(organizationId) {
      try {
        await redis.del(settingsCacheKey(organizationId))
        reportUp()
      } catch (error) {
        reportDown(error, 'drop')
      }
    },
  }
}

/**
 * A shared cache held in this process. Not something a deployment wants — it shares nothing —
 * but it is what a test uses to watch two services agree, and it is the same codec.
 */
export function createMemorySettingsCache(): SharedSettingsCache & { size(): number } {
  const entries = new Map<string, string>()
  return {
    async read(organizationId) {
      return decodeSettings(entries.get(settingsCacheKey(organizationId)))
    },
    async write(organizationId, settings) {
      entries.set(settingsCacheKey(organizationId), encodeSettings(settings))
    },
    async drop(organizationId) {
      entries.delete(settingsCacheKey(organizationId))
    },
    size: () => entries.size,
  }
}

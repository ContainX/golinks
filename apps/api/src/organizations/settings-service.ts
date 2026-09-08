// Organization settings storage and caching (spec 06 §2, §4).
//
// Settings are read on every resolver and API request, so reads go through two caches: a small
// in-process one with a thirty-second lifetime, and, when a deployment has a Redis, the shared
// one in `settings-cache.ts` with a five-minute lifetime. Writes validate the document against
// the shared schema, persist it, drop the in-process copy, and delete the shared one, so the
// replica that wrote sees the change at once and every other replica within thirty seconds
// rather than within five minutes.
//
// The shared layer is optional in every sense: a service without one behaves exactly as before,
// and one whose Redis has stopped answering falls back to the in-process cache alone.

import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type OrganizationSettings,
  type OrganizationSettingsValidationError,
  parseOrganizationSettings,
} from '@golinks/shared/settings'
import { eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { organizations } from '../db/schema/index.ts'
import type { SharedSettingsCache } from './settings-cache.ts'

/** Spec 06 §4: thirty seconds in process. */
export const DEFAULT_SETTINGS_CACHE_TTL_MS = 30_000

export interface SettingsLogger {
  warn(context: Record<string, unknown>, message: string): void
}

export interface OrganizationSettingsServiceOptions {
  /** How long a read stays cached in this process, in milliseconds. */
  cacheTtlMs?: number
  /** Clock, injectable for tests. */
  now?: () => number
  logger?: SettingsLogger
  /**
   * The cache the replicas share, normally Redis (spec 06 §4). Left out, the service keeps
   * only its in-process copy, which is the right shape for a single replica.
   */
  sharedCache?: SharedSettingsCache
}

export interface OrganizationSettingsService {
  /** Creates the organization with default settings when it does not exist yet. */
  ensureOrganization(organizationId: string): Promise<void>
  /**
   * The organization's settings, from cache when fresh. An organization without a row
   * reads as the defaults; a stored document that no longer validates also reads as the
   * defaults, with a warning, so one bad row never takes the resolver down.
   */
  getSettings(organizationId: string): Promise<OrganizationSettings>
  /** Validates, persists (creating the organization if needed), and returns the document. */
  saveSettings(organizationId: string, document: unknown): Promise<OrganizationSettings>
  /**
   * Drops this process's cached copy so the next read goes further down. The shared copy is
   * left alone: it is dropped by a write, which is the only event every replica has to see.
   */
  invalidate(organizationId: string): void
}

export class InvalidOrganizationSettingsError extends Error {
  constructor(readonly validation: OrganizationSettingsValidationError) {
    super(validation.message)
    this.name = 'InvalidOrganizationSettingsError'
  }
}

interface CacheEntry {
  settings: OrganizationSettings
  expiresAt: number
}

export function createOrganizationSettingsService(
  db: Database,
  options: OrganizationSettingsServiceOptions = {},
): OrganizationSettingsService {
  const ttl = options.cacheTtlMs ?? DEFAULT_SETTINGS_CACHE_TTL_MS
  const now = options.now ?? Date.now
  const logger = options.logger
  const shared = options.sharedCache
  const cache = new Map<string, CacheEntry>()

  function remember(organizationId: string, settings: OrganizationSettings): OrganizationSettings {
    cache.set(organizationId, { settings, expiresAt: now() + ttl })
    return settings
  }

  /** Reads the database and fills both caches. */
  async function loadFromDatabase(organizationId: string): Promise<OrganizationSettings> {
    const rows = await db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1)
    const row = rows[0]
    if (row === undefined) return DEFAULT_ORGANIZATION_SETTINGS

    const parsed = parseOrganizationSettings(row.settings)
    if (!parsed.ok) {
      logger?.warn(
        { organizationId, fields: parsed.error.fields },
        'stored organization settings do not validate; using defaults until they are repaired',
      )
      return DEFAULT_ORGANIZATION_SETTINGS
    }
    return parsed.settings
  }

  return {
    async ensureOrganization(organizationId) {
      await db
        .insert(organizations)
        .values({ id: organizationId, settings: DEFAULT_ORGANIZATION_SETTINGS })
        .onConflictDoNothing({ target: organizations.id })
    },

    async getSettings(organizationId) {
      const hit = cache.get(organizationId)
      if (hit !== undefined && hit.expiresAt > now()) return hit.settings

      // The shared copy is the cheaper of the two remaining answers, and a replica that has
      // just dropped its own copy usually finds one there (spec 06 §4).
      const sharedHit = await shared?.read(organizationId)
      if (sharedHit !== undefined) return remember(organizationId, sharedHit)

      const settings = await loadFromDatabase(organizationId)
      await shared?.write(organizationId, settings)
      return remember(organizationId, settings)
    },

    async saveSettings(organizationId, document) {
      const parsed = parseOrganizationSettings(document)
      if (!parsed.ok) throw new InvalidOrganizationSettingsError(parsed.error)

      await db
        .insert(organizations)
        .values({ id: organizationId, settings: parsed.settings })
        .onConflictDoUpdate({
          target: organizations.id,
          set: { settings: parsed.settings, updatedAt: new Date() },
        })
      cache.delete(organizationId)
      // Deleting rather than replacing: whichever replica reads next repopulates the shared
      // copy from the database, and none of them can serve a document the write superseded.
      await shared?.drop(organizationId)
      return parsed.settings
    },

    invalidate(organizationId) {
      cache.delete(organizationId)
    },
  }
}

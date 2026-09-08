// Organization settings storage and caching (spec 06 §2, §4).
//
// Settings are read on every resolver and API request, so reads go through a small
// in-process cache with a short lifetime. Writes validate the document against the shared
// schema, persist it, and drop the cached copy, so the replica that wrote sees the change
// at once and every other replica within the cache lifetime. A shared Redis layer is a
// planned addition and sits behind this same interface.

import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type OrganizationSettings,
  type OrganizationSettingsValidationError,
  parseOrganizationSettings,
} from '@golinks/shared/settings'
import { eq } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { organizations } from '../db/schema/index.ts'

/** Spec 06 §4: thirty seconds in process. */
export const DEFAULT_SETTINGS_CACHE_TTL_MS = 30_000

export interface SettingsLogger {
  warn(context: Record<string, unknown>, message: string): void
}

export interface OrganizationSettingsServiceOptions {
  /** How long a read stays cached, in milliseconds. */
  cacheTtlMs?: number
  /** Clock, injectable for tests. */
  now?: () => number
  logger?: SettingsLogger
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
  /** Drops the cached copy so the next read hits the database. */
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
  const cache = new Map<string, CacheEntry>()

  function remember(organizationId: string, settings: OrganizationSettings): OrganizationSettings {
    cache.set(organizationId, { settings, expiresAt: now() + ttl })
    return settings
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

      const rows = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1)
      const row = rows[0]
      if (row === undefined) return remember(organizationId, DEFAULT_ORGANIZATION_SETTINGS)

      const parsed = parseOrganizationSettings(row.settings)
      if (!parsed.ok) {
        logger?.warn(
          { organizationId, fields: parsed.error.fields },
          'stored organization settings do not validate; using defaults until they are repaired',
        )
        return remember(organizationId, DEFAULT_ORGANIZATION_SETTINGS)
      }
      return remember(organizationId, parsed.settings)
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
      return parsed.settings
    },

    invalidate(organizationId) {
      cache.delete(organizationId)
    },
  }
}

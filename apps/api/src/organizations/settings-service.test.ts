// The settings service under a deployment that fixes some of the document (spec 06 §6).
//
// The database is a stub: what is being tested is where the deployment's values are applied
// and which writes are refused, neither of which needs Postgres. The rest of the service is
// covered by the integration suites, which run against a real database.

import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type DeploymentSettingsOverrides,
  type OrganizationSettings,
} from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import type { Database } from '../db/client.ts'
import { createMemorySettingsCache } from './settings-cache.ts'
import {
  createOrganizationSettingsService,
  InvalidOrganizationSettingsError,
} from './settings-service.ts'

const ORGANIZATION = 'widgets.test'

/** The one row this suite needs, behind the two query shapes the service builds. */
function stubDatabase(initial?: OrganizationSettings) {
  let stored: unknown = initial
  let reads = 0

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            reads += 1
            return stored === undefined ? [] : [{ settings: stored }]
          },
        }),
      }),
    }),
    insert: () => ({
      values: (row: { settings: unknown }) => ({
        onConflictDoUpdate: async () => {
          stored = row.settings
        },
        onConflictDoNothing: async () => {
          stored ??= row.settings
        },
      }),
    }),
  }

  return {
    db: db as unknown as Database,
    reads: () => reads,
    stored: () => stored,
  }
}

function documentWith(overrides: Partial<OrganizationSettings> = {}): OrganizationSettings {
  return { ...DEFAULT_ORGANIZATION_SETTINGS, ...overrides }
}

const OVERRIDES: DeploymentSettingsOverrides = {
  readOnly: true,
  branding: { title: 'Acme Links', dark: { backgroundColor: '#000000' } },
}

describe('reads with deployment overrides', () => {
  it('answers with the effective document', async () => {
    const database = stubDatabase(documentWith({ readOnly: false }))
    const service = createOrganizationSettingsService(database.db, { overrides: OVERRIDES })

    const settings = await service.getSettings(ORGANIZATION)

    expect(settings.readOnly).toBe(true)
    expect(settings.branding.title).toBe('Acme Links')
    expect(settings.branding.dark.backgroundColor).toBe('#000000')
    // Everything the deployment left alone still comes from the stored document.
    expect(settings.branding.light.backgroundColor).toBeNull()
    expect(settings.defaultNamespace).toBe(DEFAULT_ORGANIZATION_SETTINGS.defaultNamespace)
  })

  it('applies them once, as the document enters the cache', async () => {
    const database = stubDatabase(documentWith())
    const service = createOrganizationSettingsService(database.db, { overrides: OVERRIDES })

    const first = await service.getSettings(ORGANIZATION)
    const second = await service.getSettings(ORGANIZATION)

    // The second read is a cache hit: the same object, no second query, still effective.
    expect(second).toBe(first)
    expect(second.branding.title).toBe('Acme Links')
    expect(database.reads()).toBe(1)
  })

  it('keeps the shared cache holding what is stored, not what is effective', async () => {
    const database = stubDatabase(documentWith({ readOnly: false }))
    const sharedCache = createMemorySettingsCache()
    const service = createOrganizationSettingsService(database.db, {
      overrides: OVERRIDES,
      sharedCache,
    })

    expect((await service.getSettings(ORGANIZATION)).readOnly).toBe(true)
    expect((await sharedCache.read(ORGANIZATION))?.readOnly).toBe(false)

    // A replica reading the shared copy applies the overrides for itself.
    const other = createOrganizationSettingsService(database.db, {
      overrides: OVERRIDES,
      sharedCache,
    })
    expect((await other.getSettings(ORGANIZATION)).readOnly).toBe(true)
  })

  it('leaves a document alone when the deployment fixes nothing', async () => {
    const stored = documentWith({ readOnly: false })
    const database = stubDatabase(stored)
    const service = createOrganizationSettingsService(database.db)

    expect(await service.getSettings(ORGANIZATION)).toEqual(stored)
    expect(service.managedPaths()).toEqual([])
  })
})

describe('managed paths', () => {
  it('names every field the deployment fixes, sorted', () => {
    const service = createOrganizationSettingsService(stubDatabase().db, { overrides: OVERRIDES })

    expect(service.managedPaths()).toEqual([
      'branding.dark.backgroundColor',
      'branding.title',
      'readOnly',
    ])
  })

  it('reports the managed values a document would change', () => {
    const service = createOrganizationSettingsService(stubDatabase().db, { overrides: OVERRIDES })

    const violations = service.managedViolations(
      documentWith({
        readOnly: false,
        branding: { ...DEFAULT_ORGANIZATION_SETTINGS.branding, title: 'Something else' },
      }),
    )

    expect(Object.keys(violations).sort()).toEqual([
      'branding.dark.backgroundColor',
      'branding.title',
      'readOnly',
    ])
    expect(violations.readOnly).toContain('fixed by the deployment')
  })
})

describe('saveSettings with deployment overrides', () => {
  it('refuses a document that changes a managed value', async () => {
    const database = stubDatabase(documentWith())
    const service = createOrganizationSettingsService(database.db, { overrides: OVERRIDES })

    const rejected = await service
      .saveSettings(ORGANIZATION, documentWith({ readOnly: false }))
      .catch((error: unknown) => error)

    expect(rejected).toBeInstanceOf(InvalidOrganizationSettingsError)
    const validation = (rejected as InvalidOrganizationSettingsError).validation
    expect(validation.code).toBe('validation_failed')
    expect(Object.keys(validation.fields)).toContain('readOnly')
    // Nothing was written.
    expect(database.stored()).toEqual(documentWith())
  })

  it('stores a document that leaves the managed values as the deployment fixed them', async () => {
    const database = stubDatabase()
    const service = createOrganizationSettingsService(database.db, { overrides: OVERRIDES })

    const effective = await service.getSettings(ORGANIZATION)
    const saved = await service.saveSettings(ORGANIZATION, {
      ...effective,
      namespaces: ['eng'],
    })

    expect(saved.namespaces).toEqual(['eng'])
    expect(saved.branding.title).toBe('Acme Links')
  })
})

// The organization settings service against a real Postgres (spec 06 §2, §4).

import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { organizations } from '../../src/db/schema/index.ts'
import {
  createOrganizationSettingsService,
  InvalidOrganizationSettingsError,
} from '../../src/organizations/settings-service.ts'
import { TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets

beforeEach(async () => {
  await resetDatabase()
})

describe('organization settings service', () => {
  it('ensureOrganization creates the row once, with default settings', async () => {
    const { db } = database()
    const service = createOrganizationSettingsService(db)

    await service.ensureOrganization(ORG)
    await service.ensureOrganization(ORG)

    const rows = await db.select().from(organizations).where(eq(organizations.id, ORG))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.settings).toEqual(DEFAULT_ORGANIZATION_SETTINGS)
  })

  it('reads an organization without a row as the defaults', async () => {
    const service = createOrganizationSettingsService(database().db)
    await expect(service.getSettings('nobody.test')).resolves.toEqual(DEFAULT_ORGANIZATION_SETTINGS)
  })

  it('fills a stored partial document with defaults on read', async () => {
    const { db } = database()
    await db
      .insert(organizations)
      .values({ id: ORG, settings: { defaultNamespace: 'links' } as never })
    const service = createOrganizationSettingsService(db)

    const settings = await service.getSettings(ORG)
    expect(settings.defaultNamespace).toBe('links')
    expect(settings.namespaces).toEqual([])
    expect(settings.keywords).toEqual(DEFAULT_ORGANIZATION_SETTINGS.keywords)
  })

  it('saveSettings validates, persists, and is visible on the next read', async () => {
    const service = createOrganizationSettingsService(database().db)
    await service.ensureOrganization(ORG)
    await service.getSettings(ORG) // warm the cache

    const saved = await service.saveSettings(ORG, {
      ...DEFAULT_ORGANIZATION_SETTINGS,
      namespaces: ['eng'],
      readOnly: true,
    })
    expect(saved.namespaces).toEqual(['eng'])

    const read = await service.getSettings(ORG)
    expect(read.readOnly).toBe(true)
    expect(read.namespaces).toEqual(['eng'])
  })

  it('saveSettings creates the organization when it does not exist', async () => {
    const service = createOrganizationSettingsService(database().db)
    await service.saveSettings('fresh.test', { defaultNamespace: 'go', namespaces: ['docs'] })
    const read = await service.getSettings('fresh.test')
    expect(read.namespaces).toEqual(['docs'])
  })

  it('saveSettings rejects an invalid document without writing', async () => {
    const service = createOrganizationSettingsService(database().db)
    await service.ensureOrganization(ORG)

    await expect(
      service.saveSettings(ORG, { defaultNamespace: 'Not Valid!' }),
    ).rejects.toBeInstanceOf(InvalidOrganizationSettingsError)
    await expect(service.getSettings(ORG)).resolves.toEqual(DEFAULT_ORGANIZATION_SETTINGS)
  })

  it('caches reads until the lifetime passes, and invalidate drops the copy', async () => {
    const { db } = database()
    let clock = 1_000
    const service = createOrganizationSettingsService(db, { cacheTtlMs: 100, now: () => clock })
    await service.ensureOrganization(ORG)
    expect((await service.getSettings(ORG)).readOnly).toBe(false)

    // A write that bypasses the service is invisible while the cache is fresh.
    await db
      .update(organizations)
      .set({ settings: { ...DEFAULT_ORGANIZATION_SETTINGS, readOnly: true } })
      .where(eq(organizations.id, ORG))
    expect((await service.getSettings(ORG)).readOnly).toBe(false)

    clock += 101
    expect((await service.getSettings(ORG)).readOnly).toBe(true)

    await db
      .update(organizations)
      .set({ settings: { ...DEFAULT_ORGANIZATION_SETTINGS, readOnly: false } })
      .where(eq(organizations.id, ORG))
    expect((await service.getSettings(ORG)).readOnly).toBe(true)
    service.invalidate(ORG)
    expect((await service.getSettings(ORG)).readOnly).toBe(false)
  })

  it('reads an invalid stored document as the defaults and warns', async () => {
    const { db } = database()
    await db
      .insert(organizations)
      .values({ id: ORG, settings: { defaultNamespace: 'BAD NAME' } as never })
    const logger = { warn: vi.fn() }
    const service = createOrganizationSettingsService(db, { logger })

    await expect(service.getSettings(ORG)).resolves.toEqual(DEFAULT_ORGANIZATION_SETTINGS)
    expect(logger.warn).toHaveBeenCalledTimes(1)
    expect(logger.warn.mock.calls[0]?.[0]).toMatchObject({ organizationId: ORG })
  })
})

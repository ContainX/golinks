// The unique index as the last word on a duplicate keyword (spec 03 §6.1).
//
// Conflict detection normally catches a duplicate long before the insert, so this suite
// stands it down for the whole file and lets the index do the talking. That is the state a
// request would be in if it somehow reached the insert without holding the keyword lock:
// SQLSTATE 23505 comes back, and the service has to turn it into the same `keyword_exists`
// a detected conflict would have produced.

import { count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { links } from '../../src/db/schema/index.ts'
import { isApiError } from '../../src/errors.ts'
import { createLinkWithChecks } from '../../src/links/service.ts'
import { TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { type LinkWorld, readAuditEvents, seedLinkWorld, writeContext } from './links-fixtures.ts'

vi.mock('../../src/links/conflicts.ts', () => ({
  detectKeywordConflict: async () => ({ ok: true }),
}))

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets

let world: LinkWorld

beforeEach(async () => {
  await resetDatabase()
  world = await seedLinkWorld(database().db)
})

describe('a duplicate keyword that reaches the insert', () => {
  it('comes back as keyword_exists carrying the link that won', async () => {
    const first = await createLinkWithChecks(database().db, {
      ...writeContext(world.ownerMember),
      keyword: 'handbook',
      destination: 'https://wiki.widgets.test/handbook',
    })

    const thrown = await createLinkWithChecks(database().db, {
      ...writeContext(world.bystanderMember),
      keyword: 'handbook',
      destination: 'https://elsewhere.test/',
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(isApiError(thrown)).toBe(true)
    if (!isApiError(thrown)) return
    expect(thrown.code).toBe('keyword_exists')
    expect(thrown.status).toBe(409)
    expect(thrown.message).toContain('go/handbook')
    expect(thrown.existingLink).toMatchObject({
      id: String(first.id),
      fullPath: 'go/handbook',
      owner: { email: world.owner.email },
    })
    // The database error is kept as the cause, so the logs still show what Postgres said.
    expect(thrown.cause).toBeInstanceOf(Error)
  })

  it('leaves one row and one link.created behind', async () => {
    await createLinkWithChecks(database().db, {
      ...writeContext(world.ownerMember),
      keyword: 'handbook',
      destination: 'https://wiki.widgets.test/handbook',
    })
    await createLinkWithChecks(database().db, {
      ...writeContext(world.ownerMember),
      keyword: 'handbook',
      destination: 'https://elsewhere.test/',
    }).catch(() => undefined)

    const [rows] = await database()
      .db.select({ value: count() })
      .from(links)
      .where(eq(links.organizationId, ORG))
    expect(rows?.value).toBe(1)

    const events = await readAuditEvents(database().db, ORG)
    expect(events.map((event) => event.type)).toEqual(['link.created'])
  })
})

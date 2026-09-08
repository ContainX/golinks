// The link repository against a real Postgres (spec 03 §1), including the audit rows its
// writes leave behind (spec 07 §1).

import { count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { type LinkRow, linkVisits } from '../../src/db/schema/index.ts'
import {
  deleteLink,
  findById,
  findByPrefix,
  findExact,
  findLinkOwner,
  insertLink as insertThroughRepository,
  isKeywordUniqueViolation,
  keywordColumns,
  updateLink,
} from '../../src/links/index.ts'
import { insertLink, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { evaluateFor, type LinkWorld, readAuditEvents, seedLinkWorld } from './links-fixtures.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets
const OTHER_ORG = TEST_ORGANIZATION_IDS.gizmos

let world: LinkWorld

beforeEach(async () => {
  await resetDatabase()
  world = await seedLinkWorld(database().db)
})

function seed(keyword: string, overrides: { namespace?: string } = {}): Promise<LinkRow> {
  return insertLink(database().db, {
    organizationId: ORG,
    ownerId: world.owner.id,
    keyword,
    ...overrides,
  })
}

const AUDIT = { actorUserId: 0, requestId: 'req-repository' }

function auditAs(userId: number) {
  return { ...AUDIT, actorUserId: userId }
}

describe('findExact', () => {
  it('finds the link by its canonical keyword', async () => {
    const link = await seed('handbook')
    await expect(findExact(database().db, ORG, 'go', 'handbook')).resolves.toMatchObject({
      id: link.id,
    })
  })

  it('does not cross a namespace or an organization', async () => {
    await seed('handbook')
    await expect(findExact(database().db, ORG, 'eng', 'handbook')).resolves.toBeUndefined()
    await expect(findExact(database().db, OTHER_ORG, 'go', 'handbook')).resolves.toBeUndefined()
  })
})

describe('findByPrefix', () => {
  beforeEach(async () => {
    await seed('gh/web')
    await seed('gh/%s')
    await seed('gh/%s/%s')
    await seed('handbook')
  })

  it('returns everything under the prefix, ordered by keyword', async () => {
    const rows = await findByPrefix(database().db, ORG, 'go', 'gh')
    expect(rows.map((row) => row.keyword)).toEqual(['gh/%s', 'gh/%s/%s', 'gh/web'])
  })

  it('narrows to the programmatic links', async () => {
    const rows = await findByPrefix(database().db, ORG, 'go', 'gh', { programmaticOnly: true })
    expect(rows.map((row) => row.keyword)).toEqual(['gh/%s', 'gh/%s/%s'])
  })

  it('narrows to one segment count, which is what pattern matching compares', async () => {
    const rows = await findByPrefix(database().db, ORG, 'go', 'gh', { segmentCount: 2 })
    expect(rows.map((row) => row.keyword)).toEqual(['gh/%s', 'gh/web'])
  })

  it('leaves out the link being renamed', async () => {
    const excluded = await findExact(database().db, ORG, 'go', 'gh/web')
    const rows = await findByPrefix(database().db, ORG, 'go', 'gh', {
      excludeLinkId: excluded?.id ?? 0,
    })
    expect(rows.map((row) => row.keyword)).toEqual(['gh/%s', 'gh/%s/%s'])
  })

  it('finds nothing under another organization', async () => {
    await expect(findByPrefix(database().db, OTHER_ORG, 'go', 'gh')).resolves.toEqual([])
  })
})

describe('findById', () => {
  it('reads a link of the organization', async () => {
    const link = await seed('handbook')
    await expect(findById(database().db, ORG, link.id)).resolves.toMatchObject({ id: link.id })
  })

  it('reads another organization id as missing, so 404 rather than 403 is the answer', async () => {
    const elsewhere = await seedLinkWorld(database().db, OTHER_ORG)
    const foreign = await insertLink(database().db, {
      organizationId: OTHER_ORG,
      ownerId: elsewhere.owner.id,
      keyword: 'secret',
    })

    await expect(findById(database().db, ORG, foreign.id)).resolves.toBeUndefined()
    await expect(findById(database().db, OTHER_ORG, foreign.id)).resolves.toMatchObject({
      id: foreign.id,
    })
  })

  it('reads an id that never existed as missing', async () => {
    await expect(findById(database().db, ORG, 999_999)).resolves.toBeUndefined()
  })
})

describe('findLinkOwner', () => {
  it('reads the owner of a link in the organization', async () => {
    await expect(findLinkOwner(database().db, ORG, world.owner.id)).resolves.toEqual({
      id: world.owner.id,
      email: world.owner.email,
    })
  })

  it('does not read a member of another organization', async () => {
    const elsewhere = await seedLinkWorld(database().db, OTHER_ORG)
    await expect(findLinkOwner(database().db, ORG, elsewhere.owner.id)).resolves.toBeUndefined()
  })
})

describe('insertLink', () => {
  it('stores the denormalized keyword columns a keyword evaluation produced', async () => {
    const evaluation = evaluateFor('gh/%s/%s')
    const row = await insertThroughRepository(database().db, {
      organizationId: ORG,
      namespace: 'go',
      ...keywordColumns(evaluation),
      destination: 'https://github.test/widgets/%s/issues/%s',
      ownerId: world.owner.id,
      createdById: world.owner.id,
    })

    expect(row).toMatchObject({
      keyword: 'gh/%s/%s',
      displayKeyword: 'gh/%s/%s',
      keywordPrefix: 'gh',
      segmentCount: 3,
      placeholderCount: 2,
      isUnlisted: false,
      visitCount: 0,
    })
  })

  it('leaves the unique index as the last word on a duplicate keyword', async () => {
    await seed('handbook')
    const evaluation = evaluateFor('handbook')

    const failure = await insertThroughRepository(database().db, {
      organizationId: ORG,
      namespace: 'go',
      ...keywordColumns(evaluation),
      destination: 'https://wiki.widgets.test/handbook',
      ownerId: world.owner.id,
      createdById: world.owner.id,
    }).catch((error: unknown) => error)

    expect(isKeywordUniqueViolation(failure)).toBe(true)
  })

  it('does not mistake another unique index for a keyword collision', async () => {
    const failure = await insertUser(database().db, {
      email: world.owner.email,
      organizationId: ORG,
    }).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(isKeywordUniqueViolation(failure)).toBe(false)
  })
})

describe('updateLink', () => {
  it('applies the change, moves updated_at, and records link.updated', async () => {
    const before = await seed('handbook')

    const after = await updateLink(
      database().db,
      before,
      { destination: 'https://wiki.widgets.test/handbook/v2', isUnlisted: true },
      auditAs(world.owner.id),
    )

    expect(after.destination).toBe('https://wiki.widgets.test/handbook/v2')
    expect(after.isUnlisted).toBe(true)
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(before.updatedAt.getTime())

    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: before.id })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'link.updated',
      actorUserId: world.owner.id,
      objectType: 'link',
      objectId: String(before.id),
      requestId: 'req-repository',
    })
    expect(events[0]?.data).toEqual({
      changes: {
        destination: [before.destination, 'https://wiki.widgets.test/handbook/v2'],
        isUnlisted: [false, true],
      },
    })
  })

  it('records link.transferred when the owner moves, and nothing else', async () => {
    const before = await seed('handbook')

    await updateLink(
      database().db,
      before,
      { ownerId: world.bystander.id },
      auditAs(world.admin.id),
    )

    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: before.id })
    expect(events.map((event) => event.type)).toEqual(['link.transferred'])
    expect(events[0]?.data).toEqual({
      fromUserId: String(world.owner.id),
      toUserId: String(world.bystander.id),
      method: 'direct',
    })
  })

  it('records the update and the transfer when one change does both', async () => {
    const before = await seed('handbook')

    await updateLink(
      database().db,
      before,
      { destination: 'https://wiki.widgets.test/moved', ownerId: world.bystander.id },
      { ...auditAs(world.admin.id), transferMethod: 'transferLink' },
    )

    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: before.id })
    expect(events.map((event) => event.type)).toEqual(['link.updated', 'link.transferred'])
    expect(events[1]?.data).toMatchObject({ method: 'transferLink' })
  })

  it('records nothing when the change touches nothing the trail follows', async () => {
    const before = await seed('handbook')
    await updateLink(database().db, before, {}, auditAs(world.owner.id))
    await expect(
      readAuditEvents(database().db, ORG, { type: 'link', id: before.id }),
    ).resolves.toEqual([])
  })
})

describe('deleteLink', () => {
  it('records the snapshot and then removes the row and its visits', async () => {
    const link = await seed('handbook')
    await database()
      .db.insert(linkVisits)
      .values({ linkId: link.id, organizationId: ORG, userId: world.owner.id, via: 'browser' })

    await deleteLink(database().db, link, auditAs(world.admin.id))

    await expect(findById(database().db, ORG, link.id)).resolves.toBeUndefined()
    const [visits] = await database()
      .db.select({ value: count() })
      .from(linkVisits)
      .where(eq(linkVisits.linkId, link.id))
    expect(visits?.value).toBe(0)

    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.deleted'])
    expect(events[0]?.data).toMatchObject({
      id: String(link.id),
      fullPath: 'go/handbook',
      destination: link.destination,
      ownerId: String(world.owner.id),
    })
    expect(events[0]?.actorUserId).toBe(world.admin.id)
  })
})

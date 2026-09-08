// The audit trail against a real Postgres (spec 07 §1).

import { beforeEach, describe, expect, it } from 'vitest'
import {
  linkCreatedEvent,
  linkUpdatedEvent,
  recordAuditEvent,
  recordAuditEvents,
  transferCreatedEvent,
  userCreatedEvent,
} from '../../src/audit/index.ts'
import { deleteLink, findById, updateLink } from '../../src/links/index.ts'
import { insertLink, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { type LinkWorld, readAuditEvents, seedLinkWorld } from './links-fixtures.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets
const OTHER_ORG = TEST_ORGANIZATION_IDS.gizmos

let world: LinkWorld

beforeEach(async () => {
  await resetDatabase()
  world = await seedLinkWorld(database().db)
})

function seedLink(keyword = 'handbook') {
  return insertLink(database().db, { organizationId: ORG, ownerId: world.owner.id, keyword })
}

describe('recordAuditEvent', () => {
  it('appends a row with the actor, the object, the payload, and the request id', async () => {
    const row = await recordAuditEvent(database().db, {
      organizationId: ORG,
      type: 'user.created',
      actorUserId: world.admin.id,
      objectType: 'user',
      objectId: world.owner.id,
      data: { email: world.owner.email, organizationId: ORG, role: 'member' },
      requestId: 'req-abc',
    })

    expect(row).toMatchObject({
      organizationId: ORG,
      type: 'user.created',
      actorUserId: world.admin.id,
      objectType: 'user',
      // Row ids are stored as text, so an organization id and a row id share the column.
      objectId: String(world.owner.id),
      requestId: 'req-abc',
    })
    expect(row.data).toEqual({ email: world.owner.email, organizationId: ORG, role: 'member' })
    expect(row.createdAt).toBeInstanceOf(Date)
  })

  it('accepts a system action with no actor and no request', async () => {
    const row = await recordAuditEvent(database().db, {
      organizationId: ORG,
      type: 'organization.settings_updated',
      actorUserId: null,
      objectType: 'organization',
      objectId: ORG,
    })

    expect(row.actorUserId).toBeNull()
    expect(row.requestId).toBeNull()
    expect(row.data).toEqual({})
  })

  it('keeps each organization to its own trail', async () => {
    const elsewhere = await seedLinkWorld(database().db, OTHER_ORG)
    await recordAuditEvent(database().db, {
      organizationId: OTHER_ORG,
      type: 'user.created',
      actorUserId: elsewhere.owner.id,
      objectType: 'user',
      objectId: elsewhere.owner.id,
      data: { ...userCreatedEvent(elsewhere.owner).data },
    })

    await expect(readAuditEvents(database().db, ORG)).resolves.toEqual([])
    await expect(readAuditEvents(database().db, OTHER_ORG)).resolves.toHaveLength(1)
  })
})

describe('recordAuditEvents', () => {
  it('writes the descriptors in order and skips the ones with nothing to report', async () => {
    const link = await seedLink()
    const actor = { organizationId: ORG, actorUserId: world.owner.id, requestId: 'req-batch' }

    const written = await recordAuditEvents(database().db, actor, [
      linkCreatedEvent(link),
      linkUpdatedEvent(link, link),
      transferCreatedEvent({ id: 3, linkId: link.id, expiresAt: new Date('2026-09-08T00:00:00Z') }),
    ])

    expect(written.map((row) => row.type)).toEqual(['link.created', 'transfer.created'])
    const stored = await readAuditEvents(database().db, ORG)
    expect(stored.map((row) => row.type)).toEqual(['link.created', 'transfer.created'])
    expect(stored.every((row) => row.requestId === 'req-batch')).toBe(true)
  })
})

describe('an event and the change it describes', () => {
  it('rolls back together when the transaction fails', async () => {
    const link = await seedLink()

    await expect(
      database().db.transaction(async (tx) => {
        await updateLink(
          tx,
          link,
          { destination: 'https://elsewhere.test/' },
          {
            actorUserId: world.owner.id,
          },
        )
        throw new Error('the request failed after the change')
      }),
    ).rejects.toThrow('the request failed after the change')

    await expect(findById(database().db, ORG, link.id)).resolves.toMatchObject({
      destination: link.destination,
    })
    await expect(readAuditEvents(database().db, ORG)).resolves.toEqual([])
  })

  it('keeps the deletion snapshot when the delete commits', async () => {
    const link = await seedLink()

    await database().db.transaction(async (tx) => {
      await deleteLink(tx, link, { actorUserId: world.admin.id, requestId: 'req-delete' })
    })

    await expect(findById(database().db, ORG, link.id)).resolves.toBeUndefined()
    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('link.deleted')
    expect(events[0]?.requestId).toBe('req-delete')
  })

  it('survives the link it describes, since the trail is not a foreign key', async () => {
    const link = await seedLink()
    await deleteLink(database().db, link, { actorUserId: world.admin.id })

    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events[0]?.data).toMatchObject({ id: String(link.id), fullPath: 'go/handbook' })
  })
})

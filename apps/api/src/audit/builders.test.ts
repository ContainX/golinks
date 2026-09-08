import { AuditEventTypeSchema } from '@golinks/shared/api'
import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import type { LinkRow, LinkTransferRow, UserRow } from '../db/schema/index.ts'
import {
  type AuditEventDescriptor,
  linkCreatedEvent,
  linkDeletedEvent,
  linkSnapshot,
  linkTransferredEvent,
  linkUpdatedEvent,
  organizationSettingsUpdatedEvent,
  transferCreatedEvent,
  userCreatedEvent,
  userUpdatedEvent,
} from './builders.ts'

const ORGANIZATION = 'widgets.test'

function linkRow(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 5,
    organizationId: ORGANIZATION,
    namespace: 'go',
    keyword: 'handbook',
    displayKeyword: 'handbook',
    keywordPrefix: 'handbook',
    segmentCount: 1,
    placeholderCount: 0,
    destination: 'https://wiki.widgets.test/handbook',
    ownerId: 1,
    isUnlisted: false,
    visitCount: 3,
    lastVisitedAt: null,
    createdById: 1,
    createdAt: new Date('2026-08-01T09:30:00.000Z'),
    updatedAt: new Date('2026-08-01T09:30:00.000Z'),
    ...overrides,
  }
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 1,
    email: 'ada@widgets.test',
    organizationId: ORGANIZATION,
    role: 'member',
    roleSource: 'config',
    isEnabled: true,
    preferences: {},
    lastLoginAt: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  }
}

function transferRow(overrides: Partial<LinkTransferRow> = {}): LinkTransferRow {
  return {
    id: 9,
    linkId: 5,
    tokenHash: 'f'.repeat(64),
    createdById: 1,
    expectedOwnerId: 1,
    expiresAt: new Date('2026-09-08T12:00:00.000Z'),
    acceptedById: null,
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date('2026-09-07T12:00:00.000Z'),
    ...overrides,
  }
}

/** Every builder names a type the shared catalog knows, and a payload jsonb can hold. */
function expectStorable(descriptor: AuditEventDescriptor): void {
  expect(AuditEventTypeSchema.parse(descriptor.type)).toBe(descriptor.type)
  expect(JSON.parse(JSON.stringify(descriptor.data))).toEqual(descriptor.data)
}

describe('linkSnapshot', () => {
  it('keeps the whole link, with ids as strings and timestamps as ISO 8601', () => {
    expect(linkSnapshot(linkRow({ lastVisitedAt: new Date('2026-09-02T07:00:00.000Z') }))).toEqual({
      id: '5',
      namespace: 'go',
      keyword: 'handbook',
      displayKeyword: 'handbook',
      fullPath: 'go/handbook',
      destination: 'https://wiki.widgets.test/handbook',
      isProgrammatic: false,
      placeholderCount: 0,
      segmentCount: 1,
      isUnlisted: false,
      ownerId: '1',
      createdById: '1',
      visitCount: 3,
      lastVisitedAt: '2026-09-02T07:00:00.000Z',
      createdAt: '2026-08-01T09:30:00.000Z',
      updatedAt: '2026-08-01T09:30:00.000Z',
    })
  })
})

describe('link.created', () => {
  it('carries the snapshot against the link', () => {
    const descriptor = linkCreatedEvent(linkRow())
    expectStorable(descriptor)
    expect(descriptor.type).toBe('link.created')
    expect(descriptor.objectType).toBe('link')
    expect(descriptor.objectId).toBe('5')
    expect(descriptor.data).toEqual({ ...linkSnapshot(linkRow()) })
  })
})

describe('link.updated', () => {
  it('lists each field that moved as [old, new]', () => {
    const before = linkRow()
    const after = linkRow({
      destination: 'https://wiki.widgets.test/handbook/v2',
      isUnlisted: true,
    })

    const descriptor = linkUpdatedEvent(before, after)
    expect(descriptor).not.toBeNull()
    if (descriptor === null) return
    expectStorable(descriptor)
    expect(descriptor).toEqual({
      type: 'link.updated',
      objectType: 'link',
      objectId: '5',
      data: {
        changes: {
          destination: [
            'https://wiki.widgets.test/handbook',
            'https://wiki.widgets.test/handbook/v2',
          ],
          isUnlisted: [false, true],
        },
      },
    })
  })

  it('records a rename as its keyword, display keyword, and namespace', () => {
    const before = linkRow()
    const after = linkRow({
      namespace: 'eng',
      keyword: 'runbook',
      displayKeyword: 'run-book',
      keywordPrefix: 'runbook',
    })

    expect(linkUpdatedEvent(before, after)?.data).toEqual({
      changes: {
        namespace: ['go', 'eng'],
        keyword: ['handbook', 'runbook'],
        displayKeyword: ['handbook', 'run-book'],
      },
    })
  })

  it('says nothing when nothing it tracks moved', () => {
    const before = linkRow()
    expect(linkUpdatedEvent(before, linkRow({ visitCount: 99 }))).toBeNull()
  })

  it('leaves a change of owner to link.transferred', () => {
    expect(linkUpdatedEvent(linkRow(), linkRow({ ownerId: 2 }))).toBeNull()
  })
})

describe('link.deleted', () => {
  it('carries the snapshot the row will no longer hold', () => {
    const descriptor = linkDeletedEvent(linkRow())
    expectStorable(descriptor)
    expect(descriptor.type).toBe('link.deleted')
    expect(descriptor.data).toEqual({ ...linkSnapshot(linkRow()) })
  })
})

describe('link.transferred', () => {
  it.each(['direct', 'transferLink'] as const)(
    'records both members and the %s method',
    (method) => {
      const descriptor = linkTransferredEvent(linkRow(), { fromUserId: 1, toUserId: 2, method })
      expectStorable(descriptor)
      expect(descriptor).toEqual({
        type: 'link.transferred',
        objectType: 'link',
        objectId: '5',
        data: { fromUserId: '1', toUserId: '2', method },
      })
    },
  )
})

describe('transfer.created', () => {
  it('records the link and when the token stops working', () => {
    const descriptor = transferCreatedEvent(transferRow())
    expectStorable(descriptor)
    expect(descriptor).toEqual({
      type: 'transfer.created',
      objectType: 'transfer',
      objectId: '9',
      data: { linkId: '5', expiresAt: '2026-09-08T12:00:00.000Z' },
    })
  })
})

describe('user.created', () => {
  it('records the address, the organization, and the role', () => {
    const descriptor = userCreatedEvent(userRow({ role: 'admin' }))
    expectStorable(descriptor)
    expect(descriptor).toEqual({
      type: 'user.created',
      objectType: 'user',
      objectId: '1',
      data: { email: 'ada@widgets.test', organizationId: ORGANIZATION, role: 'admin' },
    })
  })
})

describe('user.updated', () => {
  it('records a role change and a disabling', () => {
    const descriptor = userUpdatedEvent(userRow(), userRow({ role: 'admin', isEnabled: false }))
    expect(descriptor).not.toBeNull()
    if (descriptor === null) return
    expectStorable(descriptor)
    expect(descriptor).toEqual({
      type: 'user.updated',
      objectType: 'user',
      objectId: '1',
      data: { changes: { role: ['member', 'admin'], isEnabled: [true, false] } },
    })
  })

  it('says nothing about a sign-in that changed neither', () => {
    expect(
      userUpdatedEvent(userRow(), userRow({ lastLoginAt: new Date('2026-09-07T00:00:00.000Z') })),
    ).toBeNull()
  })
})

describe('organization.settings_updated', () => {
  it('lists the settings fields an admin moved', () => {
    const before = DEFAULT_ORGANIZATION_SETTINGS
    const after = {
      ...before,
      namespaces: ['eng'],
      readOnly: true,
      keywords: { ...before.keywords, punctuationSensitive: false },
    }

    const descriptor = organizationSettingsUpdatedEvent(ORGANIZATION, before, after)
    expect(descriptor).not.toBeNull()
    if (descriptor === null) return
    expectStorable(descriptor)
    expect(descriptor.type).toBe('organization.settings_updated')
    expect(descriptor.objectType).toBe('organization')
    expect(descriptor.objectId).toBe(ORGANIZATION)
    expect(descriptor.data).toEqual({
      changes: {
        namespaces: [[], ['eng']],
        readOnly: [false, true],
        keywords: [before.keywords, after.keywords],
      },
    })
  })

  it('compares sub-documents by value, not by identity', () => {
    const before = DEFAULT_ORGANIZATION_SETTINGS
    const after = {
      ...before,
      keywords: { ...before.keywords },
      branding: { ...before.branding },
      namespaces: [...before.namespaces],
    }
    expect(organizationSettingsUpdatedEvent(ORGANIZATION, before, after)).toBeNull()
  })

  it('notices a banner appearing and disappearing', () => {
    const before = DEFAULT_ORGANIZATION_SETTINGS
    const banner = { text: 'Read-only until noon.', url: null, level: 'info' } as const
    const shown = organizationSettingsUpdatedEvent(ORGANIZATION, before, { ...before, banner })
    expect(shown?.data).toEqual({ changes: { banner: [null, banner] } })

    const hidden = organizationSettingsUpdatedEvent(ORGANIZATION, { ...before, banner }, before)
    expect(hidden?.data).toEqual({ changes: { banner: [banner, null] } })
  })
})

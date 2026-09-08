import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import { isApiError } from '../errors.ts'
import type { CurrentMember } from '../types.ts'
import {
  assertCanCreateLink,
  assertCanDelete,
  assertCanEdit,
  assertCanEditDestination,
  assertCanSetOwner,
  assertCanTransfer,
  canCreateLink,
  type LinkAction,
  linkPermissionsFor,
  memberUserId,
  type PermissionSettings,
  type PermissionSubject,
} from './permissions.ts'

const HOME = 'widgets.test'
const ELSEWHERE = 'gizmos.test'

const OWNER_ID = 1

function member(id: number, role: 'member' | 'admin', organizationId = HOME): CurrentMember {
  return { id: String(id), email: `user-${id}@${organizationId}`, organizationId, role }
}

/** The four kinds of caller the table in spec 03 §5 distinguishes. */
const ACTORS = {
  owner: member(OWNER_ID, 'member'),
  admin: member(2, 'admin'),
  member: member(3, 'member'),
  foreignAdmin: member(4, 'admin', ELSEWHERE),
} as const

type ActorName = keyof typeof ACTORS

function settingsWith(overrides: Partial<PermissionSettings> = {}): PermissionSettings {
  return {
    editMode: DEFAULT_ORGANIZATION_SETTINGS.editMode,
    readOnly: DEFAULT_ORGANIZATION_SETTINGS.readOnly,
    ...overrides,
  }
}

function link(isUnlisted = false): PermissionSubject {
  return { organizationId: HOME, ownerId: OWNER_ID, isUnlisted }
}

interface MatrixRow {
  actor: ActorName
  editMode: PermissionSettings['editMode']
  readOnly: boolean
  canEditDestination: boolean
  canEdit: boolean
  canDelete: boolean
  canTransfer: boolean
  canSetOwner: boolean
}

/**
 * Every cell of spec 03 §5, in both `editMode` settings and with read-only mode on and off
 * (spec 06 §2). Read as: this caller, under these settings, may do exactly this much.
 */
const MATRIX: MatrixRow[] = [
  // The owner does everything to their own link except assign it to someone else.
  row('owner', 'ownersAndAdmins', false, [true, true, true, true, false]),
  row('owner', 'anyMember', false, [true, true, true, true, false]),
  // Read-only mode withdraws every write from members, the owner included.
  row('owner', 'ownersAndAdmins', true, [false, false, false, false, false]),
  row('owner', 'anyMember', true, [false, false, false, false, false]),

  // An admin does everything, and read-only mode does not apply to them.
  row('admin', 'ownersAndAdmins', false, [true, true, true, true, true]),
  row('admin', 'anyMember', false, [true, true, true, true, true]),
  row('admin', 'ownersAndAdmins', true, [true, true, true, true, true]),
  row('admin', 'anyMember', true, [true, true, true, true, true]),

  // Another member may touch nothing, until editMode opens the destination to them.
  row('member', 'ownersAndAdmins', false, [false, false, false, false, false]),
  row('member', 'anyMember', false, [true, false, false, false, false]),
  row('member', 'ownersAndAdmins', true, [false, false, false, false, false]),
  row('member', 'anyMember', true, [false, false, false, false, false]),

  // Nothing crosses an organization boundary, whatever the role (spec 03 §4).
  row('foreignAdmin', 'ownersAndAdmins', false, [false, false, false, false, false]),
  row('foreignAdmin', 'anyMember', false, [false, false, false, false, false]),
  row('foreignAdmin', 'ownersAndAdmins', true, [false, false, false, false, false]),
  row('foreignAdmin', 'anyMember', true, [false, false, false, false, false]),
]

function row(
  actor: ActorName,
  editMode: PermissionSettings['editMode'],
  readOnly: boolean,
  [canEditDestination, canEdit, canDelete, canTransfer, canSetOwner]: [
    boolean,
    boolean,
    boolean,
    boolean,
    boolean,
  ],
): MatrixRow {
  return {
    actor,
    editMode,
    readOnly,
    canEditDestination,
    canEdit,
    canDelete,
    canTransfer,
    canSetOwner,
  }
}

describe('linkPermissionsFor', () => {
  it.each(MATRIX)(
    '$actor with editMode $editMode and readOnly $readOnly',
    ({ actor, editMode, readOnly, ...expected }) => {
      const permissions = linkPermissionsFor(
        ACTORS[actor],
        link(),
        settingsWith({ editMode, readOnly }),
      )

      expect({
        canEditDestination: permissions.canEditDestination,
        canEdit: permissions.canEdit,
        canDelete: permissions.canDelete,
        canTransfer: permissions.canTransfer,
        canSetOwner: permissions.canSetOwner,
      }).toEqual(expected)
    },
  )

  it.each([
    ['owner', true],
    ['admin', true],
    ['member', true],
    ['foreignAdmin', false],
  ] as const)('shows a listed link to %s: %s', (actor, visible) => {
    expect(linkPermissionsFor(ACTORS[actor], link(), settingsWith()).canSeeInDirectory).toBe(
      visible,
    )
  })

  it.each([
    ['owner', true],
    ['admin', true],
    ['member', false],
    ['foreignAdmin', false],
  ] as const)('shows an unlisted link to %s: %s', (actor, visible) => {
    expect(linkPermissionsFor(ACTORS[actor], link(true), settingsWith()).canSeeInDirectory).toBe(
      visible,
    )
  })

  it('leaves an admin of the organization in charge of an unlisted link they do not own', () => {
    const permissions = linkPermissionsFor(ACTORS.admin, link(true), settingsWith())
    expect(permissions).toEqual({
      canEditDestination: true,
      canEdit: true,
      canDelete: true,
      canTransfer: true,
      canSeeInDirectory: true,
      canSetOwner: true,
    })
  })
})

describe('assertions', () => {
  const assertions: Record<
    LinkAction,
    (member: CurrentMember, settings: PermissionSettings) => void
  > = {
    editDestination: (actor, settings) => assertCanEditDestination(actor, link(), settings),
    edit: (actor, settings) => assertCanEdit(actor, link(), settings),
    delete: (actor, settings) => assertCanDelete(actor, link(), settings),
    transfer: (actor, settings) => assertCanTransfer(actor, link(), settings),
    setOwner: (actor, settings) => assertCanSetOwner(actor, link(), settings),
  }

  it.each(Object.keys(assertions) as LinkAction[])('lets an admin %s', (action) => {
    expect(() => assertions[action](ACTORS.admin, settingsWith())).not.toThrow()
  })

  it.each(['edit', 'delete', 'transfer', 'setOwner'] as const)(
    'refuses another member %s with forbidden',
    (action) => {
      expect(() => assertions[action](ACTORS.member, settingsWith())).toThrow(
        expect.objectContaining({ code: 'forbidden' }),
      )
    },
  )

  it('refuses the owner to set an owner, which only an admin does', () => {
    expect(() => assertCanSetOwner(ACTORS.owner, link(), settingsWith())).toThrow(
      expect.objectContaining({ code: 'forbidden' }),
    )
  })

  it.each(Object.keys(assertions) as LinkAction[])(
    'reports read_only rather than forbidden for a member when the organization is read-only: %s',
    (action) => {
      try {
        assertions[action](ACTORS.owner, settingsWith({ readOnly: true }))
        expect.unreachable('the assertion should have thrown')
      } catch (error) {
        expect(isApiError(error) && error.code).toBe('read_only')
        expect(isApiError(error) && error.status).toBe(403)
      }
    },
  )

  it('lets a member edit a destination when editMode is anyMember', () => {
    expect(() =>
      assertCanEditDestination(ACTORS.member, link(), settingsWith({ editMode: 'anyMember' })),
    ).not.toThrow()
  })

  it('still refuses a member the keyword when editMode is anyMember', () => {
    expect(() =>
      assertCanEdit(ACTORS.member, link(), settingsWith({ editMode: 'anyMember' })),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }))
  })
})

describe('creating links', () => {
  it.each(['owner', 'admin', 'member'] as const)('lets %s create a link', (actor) => {
    expect(canCreateLink(ACTORS[actor], settingsWith())).toBe(true)
    expect(() => assertCanCreateLink(ACTORS[actor], settingsWith())).not.toThrow()
  })

  it('stops members from creating in a read-only organization but not admins', () => {
    const settings = settingsWith({ readOnly: true })
    expect(canCreateLink(ACTORS.member, settings)).toBe(false)
    expect(canCreateLink(ACTORS.admin, settings)).toBe(true)
    expect(() => assertCanCreateLink(ACTORS.member, settings)).toThrow(
      expect.objectContaining({ code: 'read_only' }),
    )
  })
})

describe('memberUserId', () => {
  it('reads the row id back out of the string the wire carries', () => {
    expect(memberUserId(member(42, 'member'))).toBe(42)
  })

  it('refuses an id that is not a row id', () => {
    expect(() => memberUserId({ ...member(1, 'member'), id: 'me' })).toThrow('not a user id')
  })
})

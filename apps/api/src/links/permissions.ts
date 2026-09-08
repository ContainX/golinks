// The link permission table of spec 03 §5, as a pure function.
//
// The same answers drive three things: whether a request is allowed, which actions the
// directory offers (`permissions` travels with every link resource, spec 03 §10.1), and
// whether an unlisted link is visible at all (spec 03 §4). Computing them once, here,
// keeps those three from drifting apart.
//
// Two settings bend the table. `editMode: anyMember` widens destination edits to every
// member of the organization, and nothing else. `readOnly` withdraws creating, editing,
// deleting, and transferring from everyone except admins; resolution is untouched.

import type { LinkPermissions } from '@golinks/shared/api'
import type { OrganizationSettings } from '@golinks/shared/settings'
import type { LinkRow } from '../db/schema/index.ts'
import { ApiError } from '../errors.ts'
import type { CurrentMember } from '../types.ts'

/** What a permission decision needs to know about a link. */
export type PermissionSubject = Pick<LinkRow, 'organizationId' | 'ownerId' | 'isUnlisted'>

/** The settings that bend the table (spec 06 §2). */
export type PermissionSettings = Pick<OrganizationSettings, 'editMode' | 'readOnly'>

/**
 * Every cell of spec 03 §5 for one member and one link. The first four fields are the
 * `permissions` object the API returns; the rest answer questions the wire shape does not
 * carry.
 */
export interface LinkPermissionSet extends LinkPermissions {
  /** Spec 03 §4: an unlisted link is in the directory only for its owner and for admins. */
  canSeeInDirectory: boolean
  /** Spec 03 §9.1: only an admin assigns an owner without going through a transfer link. */
  canSetOwner: boolean
}

/** The row id behind a signed-in member. Ids travel as strings on the wire (spec 05 §1). */
export function memberUserId(member: CurrentMember): number {
  const id = Number(member.id)
  if (!Number.isInteger(id)) throw new Error(`"${member.id}" is not a user id.`)
  return id
}

/** Every action of spec 03 §5 that a read-only organization withdraws from non-admins. */
export type LinkAction = 'editDestination' | 'edit' | 'delete' | 'transfer' | 'setOwner'

const ACTION_LABELS: Record<LinkAction, string> = {
  editDestination: "edit this link's destination",
  edit: 'edit this link',
  delete: 'delete this link',
  transfer: 'transfer this link',
  setOwner: "set this link's owner",
}

/** Spec 03 §5 for one member and one link, with no database access and no exceptions. */
export function linkPermissionsFor(
  member: CurrentMember,
  link: PermissionSubject,
  settings: PermissionSettings,
): LinkPermissionSet {
  const sameOrganization = member.organizationId === link.organizationId
  const isAdmin = sameOrganization && member.role === 'admin'
  const isOwner = sameOrganization && memberUserId(member) === link.ownerId
  // Owner-or-admin is the shape of most of the table.
  const manages = isOwner || isAdmin
  // Read-only mode holds back every member who is not an admin (spec 06 §2).
  const writable = !settings.readOnly || isAdmin

  return {
    canEditDestination:
      writable && (manages || (sameOrganization && settings.editMode === 'anyMember')),
    canEdit: writable && manages,
    canDelete: writable && manages,
    canTransfer: writable && manages,
    canSeeInDirectory: sameOrganization && (!link.isUnlisted || manages),
    canSetOwner: isAdmin,
  }
}

/** Whether the action is permitted, read off the same table. */
export function canPerformLinkAction(
  member: CurrentMember,
  link: PermissionSubject,
  settings: PermissionSettings,
  action: LinkAction,
): boolean {
  const permissions = linkPermissionsFor(member, link, settings)
  switch (action) {
    case 'editDestination':
      return permissions.canEditDestination
    case 'edit':
      return permissions.canEdit
    case 'delete':
      return permissions.canDelete
    case 'transfer':
      return permissions.canTransfer
    case 'setOwner':
      return permissions.canSetOwner
  }
}

/**
 * Throws unless the member may take the action.
 *
 * A read-only organization reports `read_only` rather than `forbidden` for every member who
 * is not an admin, whatever the rest of the table would have said: the organization's state
 * is the more useful answer, and it leaks nothing about who owns what (spec 05 §4).
 */
export function assertLinkAction(
  member: CurrentMember,
  link: PermissionSubject,
  settings: PermissionSettings,
  action: LinkAction,
): void {
  if (canPerformLinkAction(member, link, settings, action)) return
  if (settings.readOnly && member.role !== 'admin') throw readOnlyError()
  throw new ApiError('forbidden', `You may not ${ACTION_LABELS[action]}.`)
}

/** Spec 03 §5: the destination, which `editMode: anyMember` opens to the organization. */
export function assertCanEditDestination(
  member: CurrentMember,
  link: PermissionSubject,
  settings: PermissionSettings,
): void {
  assertLinkAction(member, link, settings, 'editDestination')
}

/** Spec 03 §5: the keyword, the namespace, and the unlisted flag: owner or admin only. */
export function assertCanEdit(
  member: CurrentMember,
  link: PermissionSubject,
  settings: PermissionSettings,
): void {
  assertLinkAction(member, link, settings, 'edit')
}

export function assertCanDelete(
  member: CurrentMember,
  link: PermissionSubject,
  settings: PermissionSettings,
): void {
  assertLinkAction(member, link, settings, 'delete')
}

export function assertCanTransfer(
  member: CurrentMember,
  link: PermissionSubject,
  settings: PermissionSettings,
): void {
  assertLinkAction(member, link, settings, 'transfer')
}

export function assertCanSetOwner(
  member: CurrentMember,
  link: PermissionSubject,
  settings: PermissionSettings,
): void {
  assertLinkAction(member, link, settings, 'setOwner')
}

/** Spec 03 §5: every member creates links, unless the organization is read-only. */
export function canCreateLink(member: CurrentMember, settings: PermissionSettings): boolean {
  return !settings.readOnly || member.role === 'admin'
}

/** Step 4 of the creation order in spec 03 §6. */
export function assertCanCreateLink(member: CurrentMember, settings: PermissionSettings): void {
  if (canCreateLink(member, settings)) return
  throw readOnlyError()
}

function readOnlyError(): ApiError {
  return new ApiError(
    'read_only',
    'This organization is read-only; only an admin can change links right now.',
  )
}

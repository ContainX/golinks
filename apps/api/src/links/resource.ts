// Turning a stored link into the resource the API returns (spec 05 §2.1).
//
// The mapper is the only place that knows how a row becomes JSON, so an error carrying an
// `existingLink` (spec 05 §4) and a directory page describe the same link the same way.

import type { Link, LinkOwner, LinkPermissions } from '@golinks/shared/api'
import type { LinkRow, UserRow } from '../db/schema/index.ts'

/** What the resource shows about an owner: enough to name them, nothing more (spec 03 §4). */
export type LinkOwnerSource = Pick<UserRow, 'id' | 'email'>

/** `namespace/displayKeyword`, ready to show or copy. */
export function linkFullPath(link: Pick<LinkRow, 'namespace' | 'displayKeyword'>): string {
  return `${link.namespace}/${link.displayKeyword}`
}

/** The owner as the resource carries them. */
export function toLinkOwner(owner: LinkOwnerSource): LinkOwner {
  return { id: String(owner.id), email: owner.email }
}

/**
 * One link as the API returns it. Ids are strings and timestamps are ISO 8601 (spec 05 §1);
 * `permissions` is the caller's own answer from spec 03 §5, computed by
 * `linkPermissionsFor` and passed in so that this mapper stays free of policy.
 */
export function toLinkResource(
  row: LinkRow,
  owner: LinkOwnerSource,
  permissions: LinkPermissions,
): Link {
  return {
    id: String(row.id),
    namespace: row.namespace,
    keyword: row.keyword,
    displayKeyword: row.displayKeyword,
    fullPath: linkFullPath(row),
    destination: row.destination,
    isProgrammatic: row.placeholderCount > 0,
    placeholderCount: row.placeholderCount,
    isUnlisted: row.isUnlisted,
    owner: toLinkOwner(owner),
    visitCount: row.visitCount,
    lastVisitedAt: row.lastVisitedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    permissions: {
      canEditDestination: permissions.canEditDestination,
      canEdit: permissions.canEdit,
      canDelete: permissions.canDelete,
      canTransfer: permissions.canTransfer,
    },
  }
}

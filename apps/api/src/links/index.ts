// Barrel for the "links" module. Export public symbols from here only.

export type {
  KeywordConflict,
  KeywordConflictQuery,
  KeywordConflictReason,
  KeywordConflictResult,
} from './conflicts.ts'
export { detectKeywordConflict } from './conflicts.ts'
export type { LinkPage, LinkWithOwner, ListLinksOptions } from './listing.ts'
export {
  containsPattern,
  decodeLinkCursor,
  encodeLinkCursor,
  listLinks,
  toLinkResources,
  visibleToViewer,
} from './listing.ts'
export type { KeywordLockKey } from './locking.ts'
export { keywordLockKey, withKeywordLock } from './locking.ts'
export type {
  LinkAction,
  LinkPermissionSet,
  PermissionSettings,
  PermissionSubject,
} from './permissions.ts'
export {
  assertCanCreateLink,
  assertCanDelete,
  assertCanEdit,
  assertCanEditDestination,
  assertCanSetOwner,
  assertCanTransfer,
  assertLinkAction,
  canCreateLink,
  canPerformLinkAction,
  linkPermissionsFor,
  memberUserId,
} from './permissions.ts'
export type {
  InsertLinkValues,
  KeywordColumns,
  LinkAuditContext,
  LinkChanges,
  PrefixLookup,
} from './repository.ts'
export {
  deleteLink,
  findById,
  findByPrefix,
  findExact,
  findLinkOwner,
  insertLink,
  keywordColumns,
  updateLink,
} from './repository.ts'
export type { LinkOwnerSource } from './resource.ts'
export { linkFullPath, toLinkOwner, toLinkResource } from './resource.ts'
export type {
  CreateLinkInput,
  DeleteLinkInput,
  LinkWriteContext,
  RenameLinkInput,
} from './service.ts'
export {
  createLinkWithChecks,
  deleteLinkWithChecks,
  existingLinkResource,
  isKeywordUniqueViolation,
  normalizeNamespace,
  permissionsFor,
  renameLinkWithChecks,
  resolveNamespace,
} from './service.ts'
export type { SuggestLinksOptions } from './suggestions.ts'
export { canonicalFormOf, suggestLinks } from './suggestions.ts'
export type {
  AcceptTransferInput,
  CreatedTransfer,
  CreateTransferInput,
  PreviewTransferInput,
  TransferContext,
} from './transfers.ts'
export {
  acceptTransferWithChecks,
  createTransferWithChecks,
  generateTransferToken,
  hashTransferToken,
  previewTransfer,
  TRANSFER_PATH_PREFIX,
  TRANSFER_TOKEN_BYTES,
  toLinkSummary,
  transferUrl,
} from './transfers.ts'

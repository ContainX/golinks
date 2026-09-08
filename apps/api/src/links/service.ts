// Creating, renaming, and deleting links (spec 03 §6, §7, §8).
//
// This is where the pieces meet: the shared keyword and destination rules validate the
// input, the permission table decides whether the member may write at all, the advisory
// lock serializes everyone touching the same prefix, conflict detection has the last word,
// and the audit trail records what happened. Endpoints supply the parsed body and the
// signed-in member; everything else is decided here, so that a route handler holds no
// product rules of its own.
//
// Failures are `ApiError`s carrying the codes of spec 05 §4, and a conflict carries the
// link that stands in the way as `existingLink`.

import type { Link } from '@golinks/shared/api'
import {
  checkPlaceholderCounts,
  countDestinationPlaceholders,
  evaluateDestination,
} from '@golinks/shared/destinations'
import {
  type EvaluatedKeyword,
  evaluateKeyword,
  type KeywordNamespaceContext,
  normalizeKeyword,
} from '@golinks/shared/keywords'
import type { OrganizationSettings } from '@golinks/shared/settings'
import { and, eq } from 'drizzle-orm'
import {
  type DatabaseExecutor,
  type LinkTransferMethod,
  linkCreatedEvent,
  recordAuditEvents,
} from '../audit/index.ts'
import type { Database } from '../db/client.ts'
import { type LinkRow, users } from '../db/schema/index.ts'
import { ApiError } from '../errors.ts'
import type { CurrentMember } from '../types.ts'
import { detectKeywordConflict, type KeywordConflict } from './conflicts.ts'
import { withKeywordLock } from './locking.ts'
import {
  assertCanCreateLink,
  assertCanDelete,
  assertCanEdit,
  assertCanEditDestination,
  assertCanSetOwner,
  type LinkPermissionSet,
  linkPermissionsFor,
  memberUserId,
} from './permissions.ts'
import {
  deleteLink,
  findExact,
  findLinkOwner,
  insertLink,
  keywordColumns,
  type LinkAuditContext,
  type LinkChanges,
  updateLink,
} from './repository.ts'
import { linkFullPath, toLinkResource } from './resource.ts'

/** What every write needs to know about who is asking and where (spec 07 §1, spec 06 §2). */
export interface LinkWriteContext {
  /** The signed-in member: the audit actor, and the viewer an `existingLink` is shaped for. */
  member: CurrentMember
  settings: OrganizationSettings
  /** The `X-Request-Id` of the request, carried into the audit trail. */
  requestId?: string | null
}

export interface CreateLinkInput extends LinkWriteContext {
  /** Defaults to the organization's default namespace (spec 03 §6). */
  namespace?: string
  keyword: string
  destination: string
  isUnlisted?: boolean
  /** Admins only; defaults to the caller (spec 03 §6). */
  ownerId?: number
}

export interface RenameLinkInput extends LinkWriteContext {
  /** The link being changed, already loaded through `findById` so it is this tenant's. */
  link: LinkRow
  /** The new keyword; unchanged when omitted. */
  keyword?: string
  /** The new namespace; unchanged when omitted. */
  namespace?: string
  /** Applied in the same transaction, so one PATCH is one write (spec 03 §7). */
  destination?: string
  isUnlisted?: boolean
  ownerId?: number
  /** How the link changed hands when `ownerId` moves; `direct` by default (spec 03 §9). */
  transferMethod?: LinkTransferMethod
}

export interface DeleteLinkInput extends LinkWriteContext {
  link: LinkRow
}

/** What a locked write came back with: the row it produced, or the link in its way. */
type LinkWriteOutcome = { ok: true; row: LinkRow } | { ok: false; conflict: KeywordConflict }

/**
 * Creates a link, in the order spec 03 §6 lays out: namespace, keyword, destination,
 * read-only mode, owner, conflicts, insert, `link.created`.
 *
 * The last three run inside one transaction holding the keyword lock, so a concurrent
 * request creating the same keyword either waits and then loses to conflict detection, or
 * loses to the unique index; either way it is told `keyword_exists` and handed the link
 * that won.
 */
export async function createLinkWithChecks(db: Database, input: CreateLinkInput): Promise<LinkRow> {
  const { member, settings } = input
  const organizationId = member.organizationId

  const namespace = resolveNamespace(input.namespace, settings)
  const evaluation = evaluateKeywordOrThrow(input.keyword, settings, namespace)
  const destination = evaluateDestinationOrThrow(input.destination)
  assertPlaceholderCounts(evaluation.placeholderCount, destination.placeholderCount)
  assertCanCreateLink(member, settings)
  const ownerId = await resolveOwnerId(db, input, input.ownerId)

  const audit = auditContextFor(input)

  const outcome = await withKeywordLock(
    db,
    { organizationId, namespace, prefix: evaluation.prefix },
    async (tx): Promise<LinkWriteOutcome> => {
      const conflict = await detectKeywordConflict(tx, {
        organizationId,
        namespace,
        evaluation,
        rules: settings.keywords,
      })
      if (!conflict.ok) return { ok: false, conflict }

      const row = await insertLink(tx, {
        organizationId,
        namespace,
        ...keywordColumns(evaluation),
        destination: destination.destination,
        ownerId,
        createdById: memberUserId(member),
        isUnlisted: input.isUnlisted ?? false,
      })
      await recordAuditEvents(
        tx,
        { organizationId, actorUserId: audit.actorUserId, requestId: audit.requestId },
        [linkCreatedEvent(row)],
      )
      return { ok: true, row }
    },
  ).catch(async (error: unknown) => {
    // The unique index is the backstop when two requests slip past the lock, which can only
    // happen if one of them was not holding it (spec 03 §6.1).
    if (!isKeywordUniqueViolation(error)) throw error
    throw await keywordExistsError(db, input, namespace, evaluation, error)
  })

  if (!outcome.ok) throw await conflictError(db, input, outcome.conflict)
  return outcome.row
}

/**
 * Applies a change to a link. When the keyword or the namespace moves, the full keyword
 * validation and conflict detection run again under the lock, excluding the link itself
 * (spec 03 §7); when they do not, the keyword is left alone, because a tightened
 * `allowedPattern` applies only to new and renamed keywords (spec 06 §2).
 */
export async function renameLinkWithChecks(db: Database, input: RenameLinkInput): Promise<LinkRow> {
  const { link, member, settings } = input
  const organizationId = link.organizationId

  // An omitted namespace is the one the link already has, which is never re-checked: a
  // namespace the organization has since dropped must not block an unrelated edit.
  const namespace =
    input.namespace === undefined ? link.namespace : resolveNamespace(input.namespace, settings)
  const normalized = input.keyword === undefined ? undefined : normalizeKeyword(input.keyword)
  if (normalized !== undefined && !normalized.ok) {
    throw new ApiError(normalized.code, normalized.message)
  }
  const displayKeyword = normalized?.displayKeyword ?? link.displayKeyword
  const renamed = displayKeyword !== link.displayKeyword || namespace !== link.namespace

  const destination =
    input.destination === undefined ? undefined : evaluateDestinationOrThrow(input.destination)
  const destinationPlaceholders =
    destination?.placeholderCount ?? countDestinationPlaceholders(link.destination)

  if (renamed || input.isUnlisted !== undefined) assertCanEdit(member, link, settings)
  if (destination !== undefined) assertCanEditDestination(member, link, settings)
  const ownerId = await resolveOwnerId(db, input, input.ownerId, link)

  const changes: LinkChanges = {}
  if (destination !== undefined) changes.destination = destination.destination
  if (input.isUnlisted !== undefined) changes.isUnlisted = input.isUnlisted
  if (ownerId !== link.ownerId) changes.ownerId = ownerId

  const audit = auditContextFor(input, input.transferMethod)

  if (!renamed) {
    assertPlaceholderCounts(link.placeholderCount, destinationPlaceholders)
    if (Object.keys(changes).length === 0) return link
    return await updateLink(db, link, changes, audit)
  }

  const evaluation = evaluateKeywordOrThrow(displayKeyword, settings, namespace)
  assertPlaceholderCounts(evaluation.placeholderCount, destinationPlaceholders)

  const outcome = await withKeywordLock(
    db,
    { organizationId, namespace, prefix: evaluation.prefix },
    async (tx): Promise<LinkWriteOutcome> => {
      const conflict = await detectKeywordConflict(tx, {
        organizationId,
        namespace,
        evaluation,
        rules: settings.keywords,
        excludeLinkId: link.id,
      })
      if (!conflict.ok) return { ok: false, conflict }

      const row = await updateLink(
        tx,
        link,
        { ...changes, namespace, ...keywordColumns(evaluation) },
        audit,
      )
      return { ok: true, row }
    },
  ).catch(async (error: unknown) => {
    if (!isKeywordUniqueViolation(error)) throw error
    throw await keywordExistsError(db, input, namespace, evaluation, error)
  })

  if (!outcome.ok) throw await conflictError(db, input, outcome.conflict)
  return outcome.row
}

/**
 * Deletes a link permanently, after the permission table allows it. The `link.deleted`
 * snapshot and the delete share a transaction, so the trail can never be missing a row it
 * describes (spec 03 §8).
 */
export async function deleteLinkWithChecks(db: Database, input: DeleteLinkInput): Promise<void> {
  const { link, member, settings } = input
  assertCanDelete(member, link, settings)
  const audit = auditContextFor(input)
  await db.transaction(async (tx) => {
    await deleteLink(tx, link, audit)
  })
}

/** The link resource an error's `existingLink` carries, shaped for the member who asked. */
export async function existingLinkResource(
  db: DatabaseExecutor,
  row: LinkRow,
  context: LinkWriteContext,
): Promise<Link | undefined> {
  const owner = await findLinkOwner(db, row.organizationId, row.ownerId)
  if (owner === undefined) return undefined
  return toLinkResource(row, owner, permissionsFor(context, row))
}

/** Spec 03 §5 for a member and a link, ready to attach to a resource. */
export function permissionsFor(context: LinkWriteContext, row: LinkRow): LinkPermissionSet {
  return linkPermissionsFor(context.member, row, context.settings)
}

// --- validation steps -------------------------------------------------------

/** Trims and lowercases a namespace the way the settings schema stores one (spec 06 §2). */
export function normalizeNamespace(namespace: string): string {
  return namespace.trim().toLowerCase()
}

/**
 * Step 1 of spec 03 §6: the namespace is the default one or one the organization
 * configured. An omitted namespace is the default.
 */
export function resolveNamespace(
  namespace: string | undefined,
  settings: OrganizationSettings,
): string {
  if (namespace === undefined) return settings.defaultNamespace
  const resolved = normalizeNamespace(namespace)
  if (resolved === settings.defaultNamespace || settings.namespaces.includes(resolved)) {
    return resolved
  }
  throw new ApiError('namespace_invalid', `"${resolved}" is not a namespace of this organization.`)
}

/** The namespace context the reserved-prefix rule of spec 03 §2.5 needs. */
function namespaceContext(
  settings: OrganizationSettings,
  namespace: string,
): KeywordNamespaceContext {
  return {
    namespace,
    defaultNamespace: settings.defaultNamespace,
    namespaces: settings.namespaces,
  }
}

/** Step 2 of spec 03 §6: the whole keyword pipeline, reported as the code it failed on. */
function evaluateKeywordOrThrow(
  keyword: string,
  settings: OrganizationSettings,
  namespace: string,
): EvaluatedKeyword {
  const evaluation = evaluateKeyword(
    keyword,
    settings.keywords,
    namespaceContext(settings, namespace),
  )
  if (!evaluation.ok) throw new ApiError(evaluation.code, evaluation.message)
  return evaluation
}

/** Step 3 of spec 03 §6: the destination rules, which also count the `%s` occurrences. */
function evaluateDestinationOrThrow(destination: string) {
  const evaluated = evaluateDestination(destination)
  if (!evaluated.ok) throw new ApiError(evaluated.code, evaluated.message)
  return evaluated
}

/** The other half of step 3: the keyword and the destination must agree (spec 03 §2.4). */
function assertPlaceholderCounts(keywordCount: number, destinationCount: number): void {
  const check = checkPlaceholderCounts(keywordCount, destinationCount)
  if (!check.ok) throw new ApiError(check.code, check.message)
}

/**
 * Step 5 of spec 03 §6: an owner other than the caller is an admin's privilege, and whoever
 * is named must be an enabled member of the same organization.
 */
async function resolveOwnerId(
  db: DatabaseExecutor,
  context: LinkWriteContext,
  ownerId: number | undefined,
  link?: LinkRow,
): Promise<number> {
  const fallback = link?.ownerId ?? memberUserId(context.member)
  if (ownerId === undefined || ownerId === fallback) return fallback

  assertCanSetOwner(
    context.member,
    link ?? {
      organizationId: context.member.organizationId,
      ownerId: fallback,
      isUnlisted: false,
    },
    context.settings,
  )

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, context.member.organizationId),
        eq(users.id, ownerId),
        eq(users.isEnabled, true),
      ),
    )
    .limit(1)

  if (rows[0] === undefined) {
    throw new ApiError('owner_invalid', 'The owner must be an enabled member of this organization.')
  }
  return ownerId
}

// --- failures ---------------------------------------------------------------

function auditContextFor(
  context: LinkWriteContext,
  transferMethod?: LinkTransferMethod,
): LinkAuditContext {
  return {
    actorUserId: memberUserId(context.member),
    requestId: context.requestId ?? null,
    ...(transferMethod === undefined ? {} : { transferMethod }),
  }
}

/** Turns a detected conflict into the error the endpoint returns (spec 05 §4). */
async function conflictError(
  db: DatabaseExecutor,
  context: LinkWriteContext,
  conflict: KeywordConflict,
): Promise<ApiError> {
  const existingLink = await existingLinkResource(db, conflict.existing, context)
  return new ApiError(conflict.code, conflict.message, {
    ...(existingLink === undefined ? {} : { existingLink }),
    details: { reason: conflict.reason },
  })
}

const UNIQUE_VIOLATION = '23505'
const KEYWORD_UNIQUE_INDEX = 'links_organization_namespace_keyword_key'

/** How far down a `cause` chain to look for the driver's own error. */
const MAX_CAUSE_DEPTH = 5

/**
 * True for the unique index on `(organization_id, namespace, keyword)`. Postgres reports it
 * as SQLSTATE 23505 and names the constraint, which is checked so that some other unique
 * index is never mistaken for a keyword collision. The driver's error arrives wrapped in
 * the query error the ORM throws, so the `cause` chain is walked rather than only the
 * outermost error.
 */
export function isKeywordUniqueViolation(error: unknown): boolean {
  let candidate = error
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof candidate !== 'object' || candidate === null) return false
    const {
      code,
      constraint_name: constraint,
      cause,
    } = candidate as {
      code?: unknown
      constraint_name?: unknown
      cause?: unknown
    }
    if (code === UNIQUE_VIOLATION) {
      return constraint === undefined || constraint === KEYWORD_UNIQUE_INDEX
    }
    candidate = cause
  }
  return false
}

/** The `keyword_exists` a lost race produces, with the link that won attached. */
async function keywordExistsError(
  db: DatabaseExecutor,
  context: LinkWriteContext,
  namespace: string,
  evaluation: EvaluatedKeyword,
  cause: unknown,
): Promise<ApiError> {
  const existing = await findExact(
    db,
    context.member.organizationId,
    namespace,
    evaluation.canonicalKeyword,
  )
  const existingLink =
    existing === undefined ? undefined : await existingLinkResource(db, existing, context)
  const fullPath =
    existing === undefined ? `${namespace}/${evaluation.displayKeyword}` : linkFullPath(existing)

  return new ApiError('keyword_exists', `${fullPath} already exists.`, {
    ...(existingLink === undefined ? {} : { existingLink }),
    details: { reason: 'exact' },
    cause,
  })
}

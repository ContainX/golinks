// Ownership transfer links (spec 03 §9.2).
//
// A transfer link lets an owner hand a link to a colleague without an admin and without a user
// picker. The token is 32 random bytes shown once; only its SHA-256 hash is stored, so a leaked
// database row cannot be replayed as an acceptance.
//
// Acceptance is a chain of checks whose order is part of the contract: the caller is told the
// first thing that is wrong, and the codes are the ones spec 03 §9.2 lists. Nothing in the
// chain writes; the owner only moves once every check has passed, inside one transaction that
// also marks the transfer used, so a token cannot be spent twice.

import { createHash, randomBytes } from 'node:crypto'
import type { LinkSummary, TransferPreview, TransferStatus } from '@golinks/shared/api'
import type { OrganizationSettings } from '@golinks/shared/settings'
import { and, eq, isNull } from 'drizzle-orm'
import { type DatabaseExecutor, recordAuditEvents, transferCreatedEvent } from '../audit/index.ts'
import type { Database } from '../db/client.ts'
import {
  type LinkRow,
  type LinkTransferRow,
  links,
  linkTransfers,
  type UserRow,
  users,
} from '../db/schema/index.ts'
import { ApiError } from '../errors.ts'
import type { CurrentMember } from '../types.ts'
import { assertCanTransfer, memberUserId } from './permissions.ts'
import { findLinkOwner, updateLink } from './repository.ts'
import { type LinkOwnerSource, linkFullPath, toLinkOwner } from './resource.ts'

/** Spec 03 §9.2: the token is 32 random bytes, base64url encoded. */
export const TRANSFER_TOKEN_BYTES = 32

/** Where an acceptance URL points. The page itself belongs to the web app (spec 05 §3). */
export const TRANSFER_PATH_PREFIX = '/_/transfer'

/** A fresh token. Returned once, to the creator, and never stored in this form. */
export function generateTransferToken(): string {
  return randomBytes(TRANSFER_TOKEN_BYTES).toString('base64url')
}

/** What the row keeps instead of the token: its SHA-256, lowercase hex. */
export function hashTransferToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** `<BASE_URL>/_/transfer/<token>`, the whole of what the creator copies. */
export function transferUrl(baseUrl: string, token: string): string {
  return `${baseUrl}${TRANSFER_PATH_PREFIX}/${token}`
}

/** Everything a transfer needs to know about who is asking and under which settings. */
export interface TransferContext {
  member: CurrentMember
  settings: OrganizationSettings
  /** The `X-Request-Id` of the request, carried into the audit trail (spec 07 §1). */
  requestId?: string | null
  /** Clock, injectable so a test can place an expiry precisely. */
  now?: () => number
}

export interface CreateTransferInput extends TransferContext {
  /** The link being handed on, already loaded through `findById` so it is this tenant's. */
  link: LinkRow
  /** TRANSFER_TOKEN_TTL: how long the token stays usable. */
  tokenTtlMs: number
}

/** A newly created transfer and the one copy of its token that will ever exist. */
export interface CreatedTransfer {
  transfer: LinkTransferRow
  token: string
}

/**
 * Creates a transfer link for a link the member may transfer (spec 03 §9.2).
 *
 * Any other pending transfer for the same link is revoked in the same transaction, so a link
 * only ever has one outstanding invitation and an owner who generates a second URL knows the
 * first has stopped working.
 */
export async function createTransferWithChecks(
  db: Database,
  input: CreateTransferInput,
): Promise<CreatedTransfer> {
  const { link, member, settings } = input
  assertCanTransfer(member, link, settings)

  const token = generateTransferToken()
  const now = new Date(input.now?.() ?? Date.now())
  const expiresAt = new Date(now.getTime() + input.tokenTtlMs)
  const actorUserId = memberUserId(member)

  const transfer = await db.transaction(async (tx) => {
    await tx
      .update(linkTransfers)
      .set({ revokedAt: now })
      .where(
        and(
          eq(linkTransfers.linkId, link.id),
          isNull(linkTransfers.acceptedAt),
          isNull(linkTransfers.revokedAt),
        ),
      )

    const rows = await tx
      .insert(linkTransfers)
      .values({
        linkId: link.id,
        tokenHash: hashTransferToken(token),
        createdById: actorUserId,
        expectedOwnerId: link.ownerId,
        expiresAt,
      })
      .returning()
    const row = rows[0]
    if (row === undefined) throw new Error('Creating a transfer returned no row.')

    await recordAuditEvents(
      tx,
      {
        organizationId: link.organizationId,
        actorUserId,
        requestId: input.requestId ?? null,
      },
      [transferCreatedEvent(row)],
    )
    return row
  })

  return { transfer, token }
}

/** A transfer row together with the link it hands on, as every token lookup reads them. */
interface TransferSubject {
  transfer: LinkTransferRow
  link: LinkRow | null
}

/** Check 1 of spec 03 §9.2, by hash: the token itself is never stored to compare against. */
async function findByToken(
  db: DatabaseExecutor,
  token: string,
): Promise<TransferSubject | undefined> {
  const rows = await db
    .select({ transfer: linkTransfers, link: links })
    .from(linkTransfers)
    .leftJoin(links, eq(links.id, linkTransfers.linkId))
    .where(eq(linkTransfers.tokenHash, hashTransferToken(token)))
    .limit(1)
  return rows[0]
}

/**
 * Whether the member who created the transfer could still make it themselves (check 6).
 * That is: they are enabled, they belong to the link's organization, and they either own the
 * link or administer the organization.
 */
async function creatorStillHasAccess(
  db: DatabaseExecutor,
  transfer: LinkTransferRow,
  link: LinkRow,
): Promise<boolean> {
  const creator = await findMember(db, transfer.createdById)
  if (creator === undefined || !creator.isEnabled) return false
  if (creator.organizationId !== link.organizationId) return false
  return creator.id === link.ownerId || creator.role === 'admin'
}

type MemberRow = Pick<UserRow, 'id' | 'organizationId' | 'role' | 'isEnabled'>

async function findMember(db: DatabaseExecutor, id: number): Promise<MemberRow | undefined> {
  const rows = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      role: users.role,
      isEnabled: users.isEnabled,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  return rows[0]
}

/** Spec 05 §4: an unknown, spent, or cross-organization token is a 404, never a 403. */
function transferInvalid(
  message = 'That transfer link is not valid. Ask for a new one.',
): ApiError {
  return new ApiError('transfer_invalid', message)
}

export interface PreviewTransferInput {
  token: string
  /** The member looking at the acceptance page; a token from another tenant reads as missing. */
  member: CurrentMember
  now?: () => number
}

/**
 * The acceptance page's read (spec 03 §9.2): the same checks the acceptance runs, reported as a
 * status instead of a refusal, and nothing written.
 *
 * The tenant check comes before the status, unlike the acceptance chain, because the preview
 * hands back the link's destination and owner: a token minted in another organization must
 * read as missing before anything about the link is disclosed.
 */
export async function previewTransfer(
  db: DatabaseExecutor,
  input: PreviewTransferInput,
): Promise<TransferPreview> {
  const subject = await findByToken(db, input.token)
  // Checks 1 and 4: an unknown token, and a link that has since been deleted.
  if (subject === undefined || subject.link === null) throw transferInvalid()

  const { transfer, link } = subject
  // Check 7, brought forward: nothing about another tenant's link is described here.
  if (link.organizationId !== input.member.organizationId) throw transferInvalid()

  const owner = await findLinkOwner(db, link.organizationId, link.ownerId)
  if (owner === undefined) throw transferInvalid()

  return {
    status: await previewStatus(db, transfer, link, input.now?.() ?? Date.now()),
    link: toLinkSummary(link, owner),
    expiresAt: transfer.expiresAt.toISOString(),
  }
}

/** Where the transfer stands, in the check order of spec 03 §9.2. */
async function previewStatus(
  db: DatabaseExecutor,
  transfer: LinkTransferRow,
  link: LinkRow,
  now: number,
): Promise<TransferStatus> {
  // Check 2.
  if (transfer.expiresAt.getTime() <= now) return 'expired'
  // Check 3.
  if (transfer.acceptedAt !== null) return 'accepted'
  if (transfer.revokedAt !== null) return 'revoked'
  // Check 5: the link changed hands since the token was minted, so the offer is stale.
  if (link.ownerId !== transfer.expectedOwnerId) return 'invalid'
  // Check 6.
  if (!(await creatorStillHasAccess(db, transfer, link))) return 'invalid'
  return 'pending'
}

/** The reduced link a preview shows (spec 05 §2.4). */
export function toLinkSummary(link: LinkRow, owner: LinkOwnerSource): LinkSummary {
  return {
    id: String(link.id),
    fullPath: linkFullPath(link),
    destination: link.destination,
    owner: toLinkOwner(owner),
  }
}

export interface AcceptTransferInput extends TransferContext {
  token: string
}

/**
 * Accepts a transfer (spec 03 §9.2), running checks 1 through 9 in the order the spec gives
 * them and failing with the code that order names.
 *
 * Nothing is written until every check has passed. The write then marks the transfer accepted
 * under a condition that only holds for a token nobody has spent yet, so two members racing
 * the same URL cannot both become the owner: the loser's statement matches no row and the
 * whole transaction, the ownership change included, rolls back.
 */
export async function acceptTransferWithChecks(
  db: Database,
  input: AcceptTransferInput,
): Promise<LinkRow> {
  const now = new Date(input.now?.() ?? Date.now())
  const subject = await findByToken(db, input.token)

  // 1. The token hash exists.
  if (subject === undefined) throw transferInvalid()
  const { transfer, link } = subject

  // 2. It has not expired.
  if (transfer.expiresAt.getTime() <= now.getTime()) {
    throw new ApiError('transfer_expired', 'That transfer link has expired. Ask for a new one.')
  }

  // 3. It has not already been accepted or revoked.
  if (transfer.acceptedAt !== null || transfer.revokedAt !== null) throw transferInvalid()

  // 4. The link still exists.
  if (link === null) throw transferInvalid()

  // 5. The link has not changed hands since the token was minted.
  if (link.ownerId !== transfer.expectedOwnerId) {
    throw new ApiError(
      'transfer_owner_changed',
      'This link has a different owner than when the transfer link was created.',
    )
  }

  // 6. Whoever created the transfer could still make it.
  if (!(await creatorStillHasAccess(db, transfer, link))) {
    throw new ApiError(
      'transfer_creator_lost_access',
      'Whoever created this transfer link can no longer transfer the link.',
    )
  }

  // 7. The accepting member belongs to the link's organization and is enabled. A member of
  // another organization is told the same thing an unknown token is told.
  const accepter = await findMember(db, memberUserId(input.member))
  if (
    accepter === undefined ||
    !accepter.isEnabled ||
    accepter.organizationId !== link.organizationId
  ) {
    throw transferInvalid()
  }

  // 8. They do not already own it.
  if (accepter.id === link.ownerId) {
    throw new ApiError('transfer_already_owner', 'You already own this link.')
  }

  // 9. Accepting changes who owns a link, which read-only mode freezes for everyone but
  // admins (spec 03 §5). A token minted before the freeze waits until it is lifted.
  if (input.settings.readOnly && input.member.role !== 'admin') {
    throw new ApiError(
      'read_only',
      'Your organization is in read-only mode, so ownership cannot change right now.',
    )
  }

  return await db.transaction(async (tx) => {
    const claimed = await tx
      .update(linkTransfers)
      .set({ acceptedById: accepter.id, acceptedAt: now })
      .where(
        and(
          eq(linkTransfers.id, transfer.id),
          isNull(linkTransfers.acceptedAt),
          isNull(linkTransfers.revokedAt),
        ),
      )
      .returning({ id: linkTransfers.id })
    // Someone else spent the token between the checks above and this statement.
    if (claimed[0] === undefined) throw transferInvalid()

    return await updateLink(
      tx,
      link,
      { ownerId: accepter.id },
      {
        actorUserId: accepter.id,
        requestId: input.requestId ?? null,
        // Spec 07 §1.1: how the link changed hands, as against an admin's direct assignment.
        transferMethod: 'transferLink',
      },
    )
  })
}

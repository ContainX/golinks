// The directory query (spec 03 §10.1).
//
// One statement answers a page: the filters of spec 03 §10.1, the unlisted rule of spec 03 §4
// applied in SQL rather than after the rows are loaded, the owner joined in so that `q` can
// match an address and the resource can name them, and a keyset window so that paging never
// repeats or skips a row while the page after it is being read.
//
// The cursor is opaque to the caller and self-describing to us: it carries the sort value and
// the id of the last row it handed out, together with the ordering that produced them, so a
// page asked for under a different sort is refused rather than silently answered wrong.

import type { Link, LinkListQuery, LinkSort, SortOrder } from '@golinks/shared/api'
import type { OrganizationSettings } from '@golinks/shared/settings'
import { and, asc, desc, eq, gt, ilike, or, type SQL, sql } from 'drizzle-orm'
import type { DatabaseExecutor } from '../audit/index.ts'
import { type LinkRow, links, users } from '../db/schema/index.ts'
import { ApiError } from '../errors.ts'
import type { CurrentMember } from '../types.ts'
import { linkPermissionsFor, memberUserId } from './permissions.ts'
import { type LinkOwnerSource, toLinkResource } from './resource.ts'

/** A link and the member who owns it, as every listing reads them together. */
export interface LinkWithOwner {
  link: LinkRow
  owner: LinkOwnerSource
}

/** One page of the directory. `nextCursor` is null on the last page (spec 05 §1). */
export interface LinkPage {
  items: LinkWithOwner[]
  nextCursor: string | null
}

export interface ListLinksOptions {
  /** The viewer: their organization scopes the query and their role opens the unlisted rows. */
  member: CurrentMember
  /** The parsed query string, defaults already applied by the shared schema. */
  query: LinkListQuery
}

/** The column each `sort` value orders by. */
const SORT_COLUMNS = {
  // The directory's default: the busiest links first (spec 07 §2.1).
  visits: links.visitCount,
  // What the directory shows, so an alphabetical page reads the way it looks.
  keyword: links.displayKeyword,
  created: links.createdAt,
  updated: links.updatedAt,
} as const

/**
 * Reads one page of the directory.
 *
 * Every condition is in the statement: nothing is filtered in JavaScript, so the unlisted rule
 * cannot be forgotten on a code path and `limit` means what it says.
 */
export async function listLinks(
  db: DatabaseExecutor,
  options: ListLinksOptions,
): Promise<LinkPage> {
  const { member, query } = options
  const { sort, order, limit } = query

  const conditions: SQL[] = [
    eq(links.organizationId, member.organizationId),
    visibleToViewer(member),
  ]

  if (query.q !== undefined && query.q.length > 0) conditions.push(matches(query.q))
  if (query.namespace !== undefined) {
    conditions.push(eq(links.namespace, query.namespace.trim().toLowerCase()))
  }
  const owner = ownerFilter(member, query.owner)
  if (owner !== undefined) conditions.push(owner)
  if (query.programmatic !== undefined) {
    conditions.push(
      query.programmatic ? gt(links.placeholderCount, 0) : eq(links.placeholderCount, 0),
    )
  }
  if (query.cursor !== undefined) conditions.push(beyondCursor(sort, order, query.cursor))

  const direction = order === 'asc' ? asc : desc
  const rows = await db
    .select({
      link: links,
      owner: { id: users.id, email: users.email },
      // The sorted value in the database's own text form, which is what the cursor carries.
      sortValue: sortValueSql(sort),
    })
    .from(links)
    .innerJoin(users, eq(users.id, links.ownerId))
    .where(and(...conditions))
    // The id breaks every tie, so two rows are never ordered differently on two reads and the
    // cursor below addresses exactly one of them.
    .orderBy(direction(SORT_COLUMNS[sort]), direction(links.id))
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const last = page.at(-1)
  const nextCursor =
    rows.length > limit && last !== undefined
      ? encodeLinkCursor(sort, order, last.sortValue, last.link.id)
      : null

  return { items: page.map(({ link, owner }) => ({ link, owner })), nextCursor }
}

/** The resources a page becomes, each carrying the viewer's own permissions (spec 03 §10.1). */
export function toLinkResources(
  rows: readonly LinkWithOwner[],
  member: CurrentMember,
  settings: OrganizationSettings,
): Link[] {
  return rows.map((row) =>
    toLinkResource(row.link, row.owner, linkPermissionsFor(member, row.link, settings)),
  )
}

// --- filters ----------------------------------------------------------------

/**
 * Spec 03 §4: an unlisted link is in the directory only for its owner and for admins. The
 * condition is part of the statement, so no caller can hand out a row by forgetting it, and
 * the suggestions query applies the very same one.
 */
export function visibleToViewer(member: CurrentMember): SQL {
  if (member.role === 'admin') return sql`true`
  const viewerId = memberUserId(member)
  return sql`(${eq(links.isUnlisted, false)} or ${eq(links.ownerId, viewerId)})`
}

/** Spec 03 §10.1: `q` is a case-insensitive substring of the keyword, destination, or owner. */
function matches(term: string): SQL {
  const pattern = containsPattern(term)
  const clause = or(
    ilike(links.displayKeyword, pattern),
    ilike(links.destination, pattern),
    ilike(users.email, pattern),
  )
  // `or` is only empty when given nothing; three conditions always produce one.
  return clause ?? sql`true`
}

/** Wraps a search term so that `%` and `_` in it are matched literally rather than as wildcards. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
}

/**
 * Spec 03 §10.1: `owner` is `me` or a user id. An id that is not one of ours matches nothing,
 * the same answer a member who owns no links gets, so a mistyped filter never widens the page.
 */
function ownerFilter(member: CurrentMember, owner: string | undefined): SQL | undefined {
  if (owner === undefined) return undefined
  if (owner === 'me') return eq(links.ownerId, memberUserId(member))
  const id = Number(owner)
  if (!Number.isSafeInteger(id) || id <= 0) return sql`false`
  return eq(links.ownerId, id)
}

// --- the cursor -------------------------------------------------------------

/** How a cursor names itself, so an old one is never read under a new meaning. */
const CURSOR_VERSION = 1

/** The sort value and id a page ended on, plus the ordering that produced them. */
interface LinkCursor {
  version: number
  sort: LinkSort
  order: SortOrder
  /**
   * The row's value in the sorted column, in the database's own text form.
   *
   * Text rather than a JavaScript value on purpose: a `timestamptz` holds microseconds and a
   * `Date` only milliseconds, so a bound that had been through a `Date` would sit just before
   * the row it was taken from and hand that row out again on the next page, forever.
   */
  value: string
  id: number
}

/** The sorted value as the database prints it, read alongside the row it belongs to. */
function sortValueSql(sort: LinkSort): SQL<string> {
  switch (sort) {
    case 'visits':
      return sql<string>`${links.visitCount}::text`
    case 'keyword':
      return sql<string>`${links.displayKeyword}`
    case 'created':
      return sql<string>`${links.createdAt}::text`
    case 'updated':
      return sql<string>`${links.updatedAt}::text`
  }
}

/** The same value on its way back in, cast to the type the column compares as. */
function boundSql(sort: LinkSort, value: string): SQL {
  switch (sort) {
    case 'visits':
      return sql`${value}::bigint`
    case 'keyword':
      return sql`${value}::text`
    case 'created':
    case 'updated':
      return sql`${value}::timestamptz`
  }
}

/** The opaque cursor a page hands back. Base64url so it survives a query string untouched. */
export function encodeLinkCursor(
  sort: LinkSort,
  order: SortOrder,
  value: string,
  id: number,
): string {
  const cursor: LinkCursor = { version: CURSOR_VERSION, sort, order, value, id }
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * Reads a cursor back, refusing anything that did not come from this endpoint under the same
 * ordering: continuing a visits-descending page as a keyword-ascending one would silently skip
 * rows, which is worse than being told to start again.
 */
export function decodeLinkCursor(sort: LinkSort, order: SortOrder, cursor: string): LinkCursor {
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw invalidCursor('The cursor is not one this endpoint handed out.')
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw invalidCursor('The cursor is not one this endpoint handed out.')
  }
  const candidate = parsed as Partial<LinkCursor>
  const { value, id } = candidate
  if (
    candidate.version !== CURSOR_VERSION ||
    typeof value !== 'string' ||
    typeof id !== 'number' ||
    !Number.isSafeInteger(id)
  ) {
    throw invalidCursor('The cursor is not one this endpoint handed out.')
  }
  if (candidate.sort !== sort || candidate.order !== order) {
    throw invalidCursor('The cursor belongs to a different sort order; start from the first page.')
  }

  return { version: CURSOR_VERSION, sort, order, value, id }
}

/**
 * The keyset window: everything ordered after the row the cursor names. Comparing the sort
 * value and the id together is what makes a page stable even when many rows share a value,
 * which is the ordinary case under the default visits-descending sort.
 *
 * The bound is cast to the column's own type in SQL rather than converted in JavaScript, so
 * the comparison is exactly the one the ORDER BY made.
 */
function beyondCursor(sort: LinkSort, order: SortOrder, cursor: string): SQL {
  const { value, id } = decodeLinkCursor(sort, order, cursor)
  const column = SORT_COLUMNS[sort]
  const bound = boundSql(sort, value)
  const beyond = order === 'asc' ? sql`>` : sql`<`
  return sql`(${column} ${beyond} ${bound} or (${column} = ${bound} and ${links.id} ${beyond} ${id}))`
}

function invalidCursor(message: string): ApiError {
  return new ApiError('validation_failed', message, { details: { fields: { cursor: message } } })
}

// "Did you mean?" for a keyword that resolved to nothing (spec 03 §10.2).
//
// The ranking is trigram similarity between stored canonical keywords and the canonical form of
// what the member typed, so `handbok` finds `handbook` whatever punctuation either side carries.
// The comparison happens in Postgres through `pg_trgm`, against the GIN index on the keyword
// column, and the unlisted rule of spec 03 §4 is part of the same statement.

import { canonicalizeKeyword, normalizeKeyword } from '@golinks/shared/keywords'
import type { OrganizationSettings } from '@golinks/shared/settings'
import { and, asc, desc, eq, ne, type SQL, sql } from 'drizzle-orm'
import type { DatabaseExecutor } from '../audit/index.ts'
import { links, users } from '../db/schema/index.ts'
import type { CurrentMember } from '../types.ts'
import { type LinkWithOwner, visibleToViewer } from './listing.ts'

export interface SuggestLinksOptions {
  /** The viewer: their organization scopes the search and their role opens the unlisted rows. */
  member: CurrentMember
  settings: OrganizationSettings
  /** What the member typed, in whatever shape they typed it. */
  keyword: string
  /** Defaults to the organization's default namespace, like everything else (spec 03 §6). */
  namespace?: string | undefined
  limit: number
  /** SUGGESTION_MIN_SIMILARITY: below this a match is noise rather than a near miss. */
  minSimilarity: number
}

/**
 * The near misses for one keyword, best first.
 *
 * A keyword that cannot even be normalized has no canonical form to compare against, so it
 * suggests nothing rather than failing: this endpoint is reached from a resolver miss, where
 * the "keyword" is whatever path a member happened to open.
 */
export async function suggestLinks(
  db: DatabaseExecutor,
  options: SuggestLinksOptions,
): Promise<LinkWithOwner[]> {
  const canonical = canonicalFormOf(options.keyword, options.settings)
  if (canonical === undefined) return []

  const namespace = (options.namespace ?? options.settings.defaultNamespace).trim().toLowerCase()
  const score = sql<number>`similarity(${links.keyword}, ${canonical})`

  const conditions: SQL[] = [
    eq(links.organizationId, options.member.organizationId),
    eq(links.namespace, namespace),
    // Spec 03 §10.2: an exact match is a resolution, not a suggestion.
    ne(links.keyword, canonical),
    sql`${score} > ${options.minSimilarity}`,
    visibleToViewer(options.member),
  ]

  return await db
    .select({ link: links, owner: { id: users.id, email: users.email } })
    .from(links)
    .innerJoin(users, eq(users.id, links.ownerId))
    .where(and(...conditions))
    // Equally close keywords come back in the same order on every request.
    .orderBy(desc(score), asc(links.keyword))
    .limit(options.limit)
}

/** The canonical form of what was typed, or undefined when it is not a keyword at all. */
export function canonicalFormOf(
  keyword: string,
  settings: OrganizationSettings,
): string | undefined {
  const normalized = normalizeKeyword(keyword)
  if (!normalized.ok) return undefined
  const canonical = canonicalizeKeyword(normalized.displayKeyword, settings.keywords)
  return canonical.ok ? canonical.canonicalKeyword : undefined
}

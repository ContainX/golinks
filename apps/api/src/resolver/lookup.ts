// The resolver's reads (spec 04 §5), written against the indexes of spec 03 §1.
//
// Deliberately narrow: the resolver is the hot path and only ever reads, so it selects the
// eight columns it uses and nothing else. The general link repository, which the directory and
// the API share, is a separate concern; these two queries are meant to be folded into it once
// it exists.

import { and, asc, eq, gt } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { links, users } from '../db/schema/index.ts'
import type { LinkScope, PrefixQuery, ResolvableLink, ResolverLookup } from './resolve.ts'

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * The resolver's reads (spec 04 §5). Decorating an app with one before the resolver
     * registers replaces the queries, which is how a test resolves without a database.
     */
    resolverLookup: ResolverLookup
  }
}

/**
 * Ceiling on how many links one first segment may contribute to a pattern or fallback query.
 * Far above any real prefix, and it keeps a pathological organization from reading a table.
 */
export const MAX_PREFIX_CANDIDATES = 200

/** Exactly the columns resolution and the unserializable-destination page read. */
const RESOLVABLE_COLUMNS = {
  id: links.id,
  namespace: links.namespace,
  keyword: links.keyword,
  displayKeyword: links.displayKeyword,
  segmentCount: links.segmentCount,
  placeholderCount: links.placeholderCount,
  destination: links.destination,
  ownerId: links.ownerId,
}

/**
 * Builds the lookups over a database handle.
 *
 * The handle is read through a getter rather than captured, because `app.db` is resolved
 * lazily: an app built for a test that never resolves a keyword has no connection at all.
 */
export function createResolverLookup(database: () => Database): ResolverLookup {
  const scopeOf = (scope: LinkScope) =>
    and(eq(links.organizationId, scope.organizationId), eq(links.namespace, scope.namespace))

  return {
    async findExact(scope, canonicalKeyword): Promise<ResolvableLink | null> {
      const rows = await database()
        .select(RESOLVABLE_COLUMNS)
        .from(links)
        .where(and(scopeOf(scope), eq(links.keyword, canonicalKeyword)))
        .limit(1)
      return rows[0] ?? null
    },

    async findByPrefix(scope, prefix, query: PrefixQuery = {}): Promise<ResolvableLink[]> {
      const conditions = [scopeOf(scope), eq(links.keywordPrefix, prefix)]
      if (query.segmentCount !== undefined) {
        conditions.push(eq(links.segmentCount, query.segmentCount))
      }
      if (query.programmaticOnly === true) {
        conditions.push(gt(links.placeholderCount, 0))
      }

      return (
        database()
          .select(RESOLVABLE_COLUMNS)
          .from(links)
          .where(and(...conditions))
          // Ascending keyword is what makes the choice between two patterns deterministic
          // (spec 04 §5.2).
          .orderBy(asc(links.keyword))
          .limit(MAX_PREFIX_CANDIDATES)
      )
    },

    async findOwnerEmail(ownerId): Promise<string | null> {
      const rows = await database()
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, ownerId))
        .limit(1)
      return rows[0]?.email ?? null
    },
  }
}

// Recording a hit (spec 04 §6, spec 07 §2).
//
// The two writes happen after the redirect has left, and they are allowed to fail: a member
// who followed a link is already at their destination and nothing that happens here may reach
// them. The recorder is a decoration on the app (`app.visitRecorder`) so that a test can
// install its own, and it tracks its in-flight writes so that a test can await them:
//
// ```ts
// const response = await app.inject({ method: 'GET', url: '/handbook' })
// await app.visitRecorder.settled()
// ```
//
// The same seam is where spec 07 §2.2's buffered writer goes when write pressure asks for it.

import { eq, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { LINK_VISIT_SOURCES, type LinkVisitSource, links, linkVisits } from '../db/schema/index.ts'

declare module 'fastify' {
  interface FastifyInstance {
    /** Where hits are recorded (spec 07 §2). Replaceable before the resolver is registered. */
    visitRecorder: VisitRecorder
  }

  interface FastifyRequest {
    /** Set by the resolver on a hit; written once the response has been sent. */
    resolvedVisit: RecordedVisit | null
  }
}

/** One hit, as spec 07 §2.2 stores it. */
export interface RecordedVisit {
  linkId: number
  organizationId: string
  userId: number
  via: LinkVisitSource
}

/** Where a hit came from when nothing says otherwise (spec 04 §6). */
export const DEFAULT_VISIT_SOURCE: LinkVisitSource = 'browser'

const VISIT_SOURCES = new Set<string>(LINK_VISIT_SOURCES)

/**
 * Reads the optional `via` query parameter (spec 04 §6). Anything the catalog does not list,
 * including a repeated parameter or none at all, counts as a browser visit; a mistyped value
 * is not worth failing a redirect over.
 */
export function visitSourceOf(value: unknown): LinkVisitSource {
  const candidate = Array.isArray(value) ? value[0] : value
  if (typeof candidate !== 'string') return DEFAULT_VISIT_SOURCE
  const normalized = candidate.trim().toLowerCase()
  return VISIT_SOURCES.has(normalized) ? (normalized as LinkVisitSource) : DEFAULT_VISIT_SOURCE
}

/** Performs the writes for one visit. Rejecting is allowed; the recorder absorbs it. */
export type VisitWriter = (visit: RecordedVisit) => Promise<void>

export interface VisitLogger {
  warn(context: Record<string, unknown>, message: string): void
}

export interface VisitRecorder {
  /** Queues one visit. Never rejects, and never delays the caller (spec 04 §6). */
  record(visit: RecordedVisit): void
  /** Resolves once every visit queued so far has been written or given up on. */
  settled(): Promise<void>
}

export interface VisitRecorderOptions {
  write: VisitWriter
  logger?: VisitLogger
}

/**
 * Wraps a writer so that failures are logged rather than surfaced, and so that the writes in
 * flight can be waited for: by a test that wants to assert on them, and by shutdown, which
 * should not drop a visit it has already accepted.
 */
export function createVisitRecorder(options: VisitRecorderOptions): VisitRecorder {
  const { write, logger } = options
  const inFlight = new Set<Promise<void>>()

  return {
    record(visit) {
      const pending = write(visit)
        .catch((error: unknown) => {
          logger?.warn(
            { err: error, linkId: visit.linkId, organizationId: visit.organizationId },
            'recording a visit failed; the redirect was unaffected',
          )
        })
        .finally(() => {
          inFlight.delete(pending)
        })
      inFlight.add(pending)
    },

    async settled() {
      // A write may queue nothing else, but awaiting a snapshot twice costs nothing and keeps
      // the contract simple for callers that record in a loop.
      while (inFlight.size > 0) await Promise.all([...inFlight])
    },
  }
}

/**
 * The writes of spec 07 §2: bump the counters on the link, then append the visit row. The
 * counter is the directory's sort key and matters more than the history, so it goes first.
 */
export function createDatabaseVisitWriter(database: () => Database): VisitWriter {
  return async (visit) => {
    const db = database()
    await db
      .update(links)
      .set({
        visitCount: sql`${links.visitCount} + 1`,
        lastVisitedAt: sql`now()`,
      })
      .where(eq(links.id, visit.linkId))
    await db.insert(linkVisits).values({
      linkId: visit.linkId,
      organizationId: visit.organizationId,
      userId: visit.userId,
      via: visit.via,
    })
  }
}

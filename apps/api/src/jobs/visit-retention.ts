// Visit retention (spec 07 §2.3).
//
// `link_visits` grows with every hit, and only the recent history is worth keeping. This job
// deletes everything older than `VISIT_RETENTION_DAYS` in bounded batches so that a first run
// against years of history never turns into one enormous transaction. The counters on `links`
// are a separate column and are deliberately left alone.

import { inArray, lt } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { linkVisits } from '../db/schema/index.ts'
import type { JobReport, ScheduledJob } from './scheduler.ts'

export const VISIT_RETENTION_JOB = 'visit-retention'

/** Advisory lock key for the retention job (spec 09 §1). */
export const VISIT_RETENTION_LOCK_KEY = 907_001

/** Rows removed per statement. Large enough to make progress, small enough to stay polite. */
export const VISIT_RETENTION_BATCH_SIZE = 5_000

/** Spec 07 §2.3 leaves the cadence open; hourly keeps each run's batch count small. */
export const DEFAULT_VISIT_RETENTION_INTERVAL_MS = 3_600_000

const MILLISECONDS_PER_DAY = 86_400_000

/** The oldest `visited_at` a row may carry and still be kept. */
export function visitRetentionCutoff(retentionDays: number, nowMs: number): Date {
  return new Date(nowMs - retentionDays * MILLISECONDS_PER_DAY)
}

export interface VisitRetentionOptions {
  db: Database
  /** From `VISIT_RETENTION_DAYS` (spec 06 §1). */
  retentionDays: number
  intervalMs?: number
  batchSize?: number
  now?: () => number
}

/**
 * Deletes everything older than the cutoff, one batch at a time, and reports how much went.
 * Exported on its own so a test can run the sweep without a scheduler.
 */
export async function sweepExpiredVisits(options: VisitRetentionOptions): Promise<JobReport> {
  const { db, retentionDays } = options
  const batchSize = options.batchSize ?? VISIT_RETENTION_BATCH_SIZE
  const cutoff = visitRetentionCutoff(retentionDays, (options.now ?? Date.now)())

  let deleted = 0
  let batches = 0

  for (;;) {
    // The subquery picks the batch by the `(organization_id, visited_at)` index and the delete
    // works from primary keys, so neither statement holds more rows than the batch size.
    const doomed = db
      .select({ id: linkVisits.id })
      .from(linkVisits)
      .where(lt(linkVisits.visitedAt, cutoff))
      .limit(batchSize)

    const gone = await db
      .delete(linkVisits)
      .where(inArray(linkVisits.id, doomed))
      .returning({ id: linkVisits.id })

    batches += 1
    deleted += gone.length
    if (gone.length < batchSize) break
  }

  return { deleted, batches, cutoff: cutoff.toISOString() }
}

/** The retention job as the scheduler takes it. */
export function createVisitRetentionJob(options: VisitRetentionOptions): ScheduledJob {
  return {
    name: VISIT_RETENTION_JOB,
    intervalMs: options.intervalMs ?? DEFAULT_VISIT_RETENTION_INTERVAL_MS,
    lockKey: VISIT_RETENTION_LOCK_KEY,
    run: () => sweepExpiredVisits(options),
  }
}

// Expired-session sweep (spec 02 §3).
//
// Only the Postgres session store needs one: a row stays behind until something deletes it,
// whereas Redis expires its own keys. `createPostgresSessionStore` already knows how to remove
// everything past its absolute lifetime; this job is what calls it on a schedule.

import type { PostgresSessionStore } from '../auth/session-stores.ts'
import type { SessionStore } from '../security/session.ts'
import type { JobReport, ScheduledJob } from './scheduler.ts'

export const SESSION_SWEEP_JOB = 'session-sweep'

/** Advisory lock key for the session sweep (spec 09 §1). */
export const SESSION_SWEEP_LOCK_KEY = 907_002

/** Rows expire continuously, so a quarter-hour keeps the table close to the truth. */
export const DEFAULT_SESSION_SWEEP_INTERVAL_MS = 900_000

/**
 * The store as a sweepable one, or undefined when it is not.
 *
 * This is also how the wiring decides whether the job exists at all: with `REDIS_URL` set the
 * configured store is the Redis one, it has nothing to sweep, and no job is scheduled.
 */
export function sweepableSessionStore(store: SessionStore): PostgresSessionStore | undefined {
  const candidate = store as Partial<PostgresSessionStore>
  return typeof candidate.sweepExpired === 'function' ? (store as PostgresSessionStore) : undefined
}

export interface SessionSweepOptions {
  store: PostgresSessionStore
  intervalMs?: number
}

/** The sweep as the scheduler takes it. */
export function createSessionSweepJob(options: SessionSweepOptions): ScheduledJob {
  return {
    name: SESSION_SWEEP_JOB,
    intervalMs: options.intervalMs ?? DEFAULT_SESSION_SWEEP_INTERVAL_MS,
    lockKey: SESSION_SWEEP_LOCK_KEY,
    async run(): Promise<JobReport> {
      return { deleted: await options.store.sweepExpired() }
    },
  }
}

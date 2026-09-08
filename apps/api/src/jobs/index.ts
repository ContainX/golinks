// Background jobs (spec 09 §1): what runs on a schedule, and the one call that wires it up.
//
// The service image is one container that serves traffic and does housekeeping, so the
// scheduler lives inside the same process as the API. Running several replicas is still safe:
// each job takes a Postgres advisory lock for the length of its run, and the replicas that
// lose the race record a skipped run and go back to sleep.

import type postgres from 'postgres'
import type { Database } from '../db/client.ts'
import type { SessionStore } from '../security/session.ts'
import type { GoLinksApp } from '../types.ts'
import { createAdvisoryJobLock } from './advisory-lock.ts'
import { createJobScheduler, type JobScheduler, type ScheduledJob } from './scheduler.ts'
import { createSessionSweepJob, sweepableSessionStore } from './session-sweep.ts'
import { createVisitRetentionJob } from './visit-retention.ts'

export {
  alwaysGrantedJobLock,
  createAdvisoryJobLock,
  type JobLock,
  type JobLockAttempt,
  neverGrantedJobLock,
} from './advisory-lock.ts'
export {
  createJobScheduler,
  type JobLogger,
  type JobMetrics,
  type JobReport,
  type JobScheduler,
  type JobSchedulerOptions,
  type ScheduledJob,
} from './scheduler.ts'
export {
  createSessionSweepJob,
  DEFAULT_SESSION_SWEEP_INTERVAL_MS,
  SESSION_SWEEP_JOB,
  SESSION_SWEEP_LOCK_KEY,
  sweepableSessionStore,
} from './session-sweep.ts'
export {
  createVisitRetentionJob,
  DEFAULT_VISIT_RETENTION_INTERVAL_MS,
  sweepExpiredVisits,
  VISIT_RETENTION_BATCH_SIZE,
  VISIT_RETENTION_JOB,
  VISIT_RETENTION_LOCK_KEY,
  visitRetentionCutoff,
} from './visit-retention.ts'

export interface BackgroundJobsOptions {
  /** Where the retention delete runs. */
  db: Database
  /** The raw handle the advisory lock reserves a connection from. */
  sql: postgres.Sql
  /** The configured session store; the sweep is scheduled only when it is the Postgres one. */
  sessionStore: SessionStore
  /** Overrides the intervals, which a test needs and a deployment does not. */
  intervals?: { visitRetentionMs?: number; sessionSweepMs?: number }
  /** How long after start the first run of each job happens. */
  initialDelayMs?: number
}

/**
 * Builds the scheduler this deployment should run and arms it, unless `JOBS_ENABLED` is off.
 * The returned scheduler is stopped by an `onClose` hook, so shutting the app down waits for a
 * run that is already under way.
 */
export function startBackgroundJobs(
  app: GoLinksApp,
  options: BackgroundJobsOptions,
): JobScheduler | undefined {
  if (!app.appConfig.jobs.enabled) {
    app.log.info({}, 'background jobs are disabled on this replica')
    return undefined
  }

  const jobs: ScheduledJob[] = [
    createVisitRetentionJob({
      db: options.db,
      retentionDays: app.appConfig.visits.retentionDays,
      ...(options.intervals?.visitRetentionMs === undefined
        ? {}
        : { intervalMs: options.intervals.visitRetentionMs }),
    }),
  ]

  // Redis expires its own session keys, so there is nothing to sweep there (spec 02 §3).
  const sweepable = sweepableSessionStore(options.sessionStore)
  if (sweepable !== undefined) {
    jobs.push(
      createSessionSweepJob({
        store: sweepable,
        ...(options.intervals?.sessionSweepMs === undefined
          ? {}
          : { intervalMs: options.intervals.sessionSweepMs }),
      }),
    )
  }

  const scheduler = createJobScheduler({
    jobs,
    logger: app.log,
    metrics: app.metrics,
    lock: createAdvisoryJobLock(options.sql),
    ...(options.initialDelayMs === undefined ? {} : { initialDelayMs: options.initialDelayMs }),
  })

  app.addHook('onClose', async () => {
    await scheduler.stop()
  })

  scheduler.start()
  app.log.info({ jobs: scheduler.jobNames() }, 'background jobs scheduled')
  return scheduler
}

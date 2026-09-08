// The background job scheduler (spec 09 §1).
//
// Small on purpose: a named job, an interval, and an advisory-lock key. The scheduler runs each
// job on its own timer, asks the lock whether this replica is the one that should run it,
// records the outcome against `golinks_job_runs_total` (spec 07 §3), and logs a line at the
// start and at the end. Nothing here knows what a job does; the jobs themselves live beside
// this file and are handed in.
//
// Each job is re-armed only once its previous run has settled, so a run that overruns its
// interval delays the next one instead of racing it.

import type { JobOutcome } from '../metrics/registry.ts'
import { alwaysGrantedJobLock, type JobLock } from './advisory-lock.ts'

/**
 * What a finished run has to say for itself, as fields on the "finished" log line. A job with
 * nothing to report returns an empty one.
 */
export type JobReport = Record<string, number | string | boolean>

/** One unit of scheduled work. */
export interface ScheduledJob {
  /** Metric label and log field. Unique across the scheduler. */
  name: string
  /** How long the scheduler waits between runs, in milliseconds. */
  intervalMs: number
  /** The `pg_try_advisory_lock` key that keeps this job to one replica (spec 09 §1). */
  lockKey: number
  /** Does the work. What it returns is logged with the "finished" line. */
  run(): Promise<JobReport>
}

export interface JobLogger {
  info(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
  error(context: Record<string, unknown>, message: string): void
}

/** The slice of the service's instruments the scheduler writes to. */
export interface JobMetrics {
  recordJobRun(job: string, outcome: JobOutcome): void
}

/** A pending timer, opaque to the scheduler so a test can hand back whatever it likes. */
export type JobTimer = unknown

export interface JobSchedulerOptions {
  jobs: readonly ScheduledJob[]
  logger: JobLogger
  metrics: JobMetrics
  /** Defaults to the always-granted lock, which is right for a single process. */
  lock?: JobLock
  /**
   * How long after `start()` each job first runs. Defaults to its own interval, so a fleet
   * that has just been deployed does not spend its first second on housekeeping.
   */
  initialDelayMs?: number
  /** One-shot timer seams, so a test does not have to wait out an hour. */
  setTimer?: (handler: () => void, delayMs: number) => JobTimer
  clearTimer?: (timer: JobTimer) => void
  /** Clock for the duration field. */
  now?: () => number
}

export interface JobScheduler {
  /** Arms every job's timer. Calling it twice is a no-op. */
  start(): void
  /** Runs one job now and reports what happened. The timers use this too. */
  runOnce(name: string): Promise<JobOutcome>
  /** Disarms the timers and waits for whatever is still running. */
  stop(): Promise<void>
  /** The job names this scheduler knows, in the order they were given. */
  jobNames(): readonly string[]
}

function defaultSetTimer(handler: () => void, delayMs: number): JobTimer {
  // A background job must never be the reason the process stays up.
  return setTimeout(handler, delayMs).unref()
}

function defaultClearTimer(timer: JobTimer): void {
  clearTimeout(timer as NodeJS.Timeout)
}

/**
 * Builds a scheduler over `jobs`. Nothing runs until `start()`; `stop()` is what an `onClose`
 * hook calls, and it resolves once no run is in flight.
 */
export function createJobScheduler(options: JobSchedulerOptions): JobScheduler {
  const { jobs, logger, metrics } = options
  const lock = options.lock ?? alwaysGrantedJobLock
  const setTimer = options.setTimer ?? defaultSetTimer
  const clearTimer = options.clearTimer ?? defaultClearTimer
  const now = options.now ?? Date.now

  const byName = new Map<string, ScheduledJob>()
  for (const job of jobs) {
    if (byName.has(job.name)) throw new Error(`Two jobs are both named "${job.name}".`)
    byName.set(job.name, job)
  }

  const timers = new Map<string, JobTimer>()
  /** Runs that have not settled yet, so `stop()` can wait for them. */
  const inFlight = new Map<string, Promise<JobOutcome>>()
  let started = false
  let stopped = false

  async function execute(job: ScheduledJob): Promise<JobOutcome> {
    logger.info({ job: job.name }, 'background job started')
    const startedAt = now()

    try {
      const attempt = await lock.hold(job.lockKey, async () => job.run())
      if (!attempt.held) {
        // Every replica schedules every job; the loser of the race has nothing to report.
        logger.info({ job: job.name }, 'background job skipped: another replica holds the lock')
        metrics.recordJobRun(job.name, 'skipped')
        return 'skipped'
      }

      logger.info(
        { job: job.name, durationMs: now() - startedAt, ...attempt.value },
        'background job finished',
      )
      metrics.recordJobRun(job.name, 'succeeded')
      return 'succeeded'
    } catch (error) {
      // A failed run is reported and forgotten; the next interval tries again.
      logger.error(
        { job: job.name, durationMs: now() - startedAt, err: error },
        'background job failed',
      )
      metrics.recordJobRun(job.name, 'failed')
      return 'failed'
    }
  }

  function runOnce(name: string): Promise<JobOutcome> {
    const job = byName.get(name)
    if (job === undefined) return Promise.reject(new Error(`No job is named "${name}".`))

    // A run already under way on this replica is the answer to a second request for one.
    const running = inFlight.get(name)
    if (running !== undefined) return running

    const attempt = execute(job).finally(() => {
      inFlight.delete(name)
    })
    inFlight.set(name, attempt)
    return attempt
  }

  function arm(job: ScheduledJob, delayMs: number): void {
    timers.set(
      job.name,
      setTimer(() => {
        timers.delete(job.name)
        void runOnce(job.name).finally(() => {
          if (!stopped) arm(job, job.intervalMs)
        })
      }, delayMs),
    )
  }

  return {
    start() {
      if (started || stopped) return
      started = true
      for (const job of jobs) arm(job, options.initialDelayMs ?? job.intervalMs)
    },

    runOnce,

    async stop() {
      stopped = true
      started = false
      for (const timer of timers.values()) clearTimer(timer)
      timers.clear()
      await Promise.allSettled([...inFlight.values()])
    },

    jobNames: () => jobs.map((job) => job.name),
  }
}

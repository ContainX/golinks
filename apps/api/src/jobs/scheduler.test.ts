import { describe, expect, it, vi } from 'vitest'
import type { JobOutcome } from '../metrics/registry.ts'
import { alwaysGrantedJobLock, type JobLock, neverGrantedJobLock } from './advisory-lock.ts'
import {
  createJobScheduler,
  type JobLogger,
  type JobReport,
  type ScheduledJob,
} from './scheduler.ts'

/** Collects what the scheduler said, so a test can read the lines back. */
function recordingLogger(): JobLogger & { lines: { level: string; message: string }[] } {
  const lines: { level: string; message: string }[] = []
  return {
    lines,
    info: (_context, message) => lines.push({ level: 'info', message }),
    warn: (_context, message) => lines.push({ level: 'warn', message }),
    error: (_context, message) => lines.push({ level: 'error', message }),
  }
}

function recordingMetrics(): {
  recordJobRun(job: string, outcome: JobOutcome): void
  runs: { job: string; outcome: JobOutcome }[]
} {
  const runs: { job: string; outcome: JobOutcome }[] = []
  return { runs, recordJobRun: (job, outcome) => runs.push({ job, outcome }) }
}

interface ManualTimer {
  handler: () => void
  delayMs: number
  cancelled: boolean
  fired: boolean
}

/** Timers a test fires by hand, so nothing waits on a real clock. */
function manualTimers(): {
  setTimer: (handler: () => void, delayMs: number) => unknown
  clearTimer: (timer: unknown) => void
  armed: ManualTimer[]
  /** Delays of the timers still waiting to fire. */
  waiting(): number[]
  fireAll(): void
} {
  const armed: ManualTimer[] = []
  return {
    armed,
    setTimer(handler, delayMs) {
      const entry: ManualTimer = { handler, delayMs, cancelled: false, fired: false }
      armed.push(entry)
      return entry
    },
    clearTimer(timer) {
      ;(timer as ManualTimer).cancelled = true
    },
    waiting() {
      return armed.filter((entry) => !entry.cancelled && !entry.fired).map((one) => one.delayMs)
    },
    fireAll() {
      for (const entry of [...armed]) {
        if (entry.cancelled || entry.fired) continue
        entry.fired = true
        entry.handler()
      }
    },
  }
}

/** Lets every already-resolved promise settle, so a re-armed timer is observable. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function job(name: string, run: () => Promise<JobReport>): ScheduledJob {
  return { name, intervalMs: 60_000, lockKey: 1, run }
}

describe('job scheduler', () => {
  it('records a successful run and logs it starting and finishing', async () => {
    const logger = recordingLogger()
    const metrics = recordingMetrics()
    const scheduler = createJobScheduler({
      jobs: [job('sweep', async () => ({ deleted: 3 }))],
      logger,
      metrics,
    })

    await expect(scheduler.runOnce('sweep')).resolves.toBe('succeeded')
    expect(metrics.runs).toEqual([{ job: 'sweep', outcome: 'succeeded' }])
    expect(logger.lines.map((line) => line.message)).toEqual([
      'background job started',
      'background job finished',
    ])
  })

  it('reports a job that another replica already holds as skipped, without running it', async () => {
    const run = vi.fn(async () => ({ deleted: 0 }))
    const metrics = recordingMetrics()
    const scheduler = createJobScheduler({
      jobs: [job('sweep', run)],
      logger: recordingLogger(),
      metrics,
      lock: neverGrantedJobLock,
    })

    await expect(scheduler.runOnce('sweep')).resolves.toBe('skipped')
    expect(run).not.toHaveBeenCalled()
    expect(metrics.runs).toEqual([{ job: 'sweep', outcome: 'skipped' }])
  })

  it('records a failed run and lets the next one try again', async () => {
    const logger = recordingLogger()
    const metrics = recordingMetrics()
    let attempts = 0
    const scheduler = createJobScheduler({
      jobs: [
        job('sweep', async () => {
          attempts += 1
          if (attempts === 1) throw new Error('the table was busy')
          return {}
        }),
      ],
      logger,
      metrics,
    })

    await expect(scheduler.runOnce('sweep')).resolves.toBe('failed')
    await expect(scheduler.runOnce('sweep')).resolves.toBe('succeeded')
    expect(metrics.runs.map((run) => run.outcome)).toEqual(['failed', 'succeeded'])
    expect(logger.lines.some((line) => line.level === 'error')).toBe(true)
  })

  it('releases the lock however the run ends', async () => {
    const released: string[] = []
    const lock: JobLock = {
      async hold(_key, body) {
        try {
          return { held: true, value: await body() }
        } finally {
          released.push('released')
        }
      },
    }
    const scheduler = createJobScheduler({
      jobs: [
        job('sweep', async () => {
          throw new Error('no')
        }),
      ],
      logger: recordingLogger(),
      metrics: recordingMetrics(),
      lock,
    })

    await expect(scheduler.runOnce('sweep')).resolves.toBe('failed')
    expect(released).toEqual(['released'])
  })

  it('runs each job on its own interval and re-arms only once the run has settled', async () => {
    const timers = manualTimers()
    const runs: string[] = []
    const scheduler = createJobScheduler({
      jobs: [
        {
          name: 'hourly',
          intervalMs: 3_600_000,
          lockKey: 1,
          run: async () => {
            runs.push('hourly')
            return {}
          },
        },
        {
          name: 'quarterly',
          intervalMs: 900_000,
          lockKey: 2,
          run: async () => {
            runs.push('quarterly')
            return {}
          },
        },
      ],
      logger: recordingLogger(),
      metrics: recordingMetrics(),
      lock: alwaysGrantedJobLock,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    })

    scheduler.start()
    // Each job is armed once, at its own interval, and nothing has run yet.
    expect(timers.waiting()).toEqual([3_600_000, 900_000])
    expect(runs).toEqual([])

    timers.fireAll()
    await settle()

    expect(runs).toEqual(['hourly', 'quarterly'])
    // Each job is re-armed at its own interval once its run has settled.
    expect(timers.waiting()).toEqual([3_600_000, 900_000])

    await scheduler.stop()
    expect(timers.waiting()).toEqual([])
  })

  it('honours an initial delay of its own when one is given', () => {
    const timers = manualTimers()
    const scheduler = createJobScheduler({
      jobs: [job('sweep', async () => ({}))],
      logger: recordingLogger(),
      metrics: recordingMetrics(),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      initialDelayMs: 25,
    })

    scheduler.start()
    expect(timers.waiting()).toEqual([25])
  })

  it('answers a second request for a run already under way with the same run', async () => {
    let started = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = createJobScheduler({
      jobs: [
        job('sweep', async () => {
          started += 1
          await gate
          return {}
        }),
      ],
      logger: recordingLogger(),
      metrics: recordingMetrics(),
    })

    const first = scheduler.runOnce('sweep')
    const second = scheduler.runOnce('sweep')
    release()

    await expect(Promise.all([first, second])).resolves.toEqual(['succeeded', 'succeeded'])
    expect(started).toBe(1)
  })

  it('refuses a name it does not know and a duplicate name', async () => {
    const scheduler = createJobScheduler({
      jobs: [job('sweep', async () => ({}))],
      logger: recordingLogger(),
      metrics: recordingMetrics(),
    })
    await expect(scheduler.runOnce('nothing')).rejects.toThrow('No job is named "nothing"')

    expect(() =>
      createJobScheduler({
        jobs: [job('sweep', async () => ({})), job('sweep', async () => ({}))],
        logger: recordingLogger(),
        metrics: recordingMetrics(),
      }),
    ).toThrow('Two jobs are both named "sweep"')
  })

  it('stops cleanly, cancelling the timers and waiting for the run in flight', async () => {
    const timers = manualTimers()
    let runs = 0
    const scheduler = createJobScheduler({
      jobs: [
        job('sweep', async () => {
          await Promise.resolve()
          runs += 1
          return {}
        }),
      ],
      logger: recordingLogger(),
      metrics: recordingMetrics(),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      initialDelayMs: 0,
    })

    scheduler.start()
    timers.fireAll()
    await scheduler.stop()

    // The run that had begun was waited for, and nothing is left armed.
    expect(runs).toBe(1)
    expect(timers.waiting()).toEqual([])

    // A stopped scheduler stays stopped.
    scheduler.start()
    timers.fireAll()
    await settle()
    expect(runs).toBe(1)
  })
})

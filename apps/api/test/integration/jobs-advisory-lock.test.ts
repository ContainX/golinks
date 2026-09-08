// The single-runner guarantee (spec 09 §1).
//
// Every replica schedules every job, so what has to be true is that only one of them does the
// work. These cases run two schedulers against the same database and watch the second one
// record a skipped run instead of a second sweep.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  createAdvisoryJobLock,
  createJobScheduler,
  type ScheduledJob,
} from '../../src/jobs/index.ts'
import type { JobOutcome } from '../../src/metrics/registry.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()

/** A key nothing else in the suite uses. */
const TEST_LOCK_KEY = 907_900

beforeEach(async () => {
  await resetDatabase()
})

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

/** A scheduler with one job, over its own view of the shared lock. */
function replica(job: ScheduledJob): {
  run(): Promise<JobOutcome>
  stop(): Promise<void>
} {
  const scheduler = createJobScheduler({
    jobs: [job],
    logger: silentLogger,
    metrics: { recordJobRun: () => {} },
    lock: createAdvisoryJobLock(database().sql),
  })
  return { run: () => scheduler.runOnce(job.name), stop: () => scheduler.stop() }
}

describe('the job advisory lock', () => {
  it('lets one replica through and turns the other away while the run is under way', async () => {
    let running = 0
    let peak = 0
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const job = (name: string): ScheduledJob => ({
      name,
      intervalMs: 60_000,
      lockKey: TEST_LOCK_KEY,
      async run() {
        running += 1
        peak = Math.max(peak, running)
        await held
        running -= 1
        return {}
      },
    })

    const first = replica(job('sweep'))
    const second = replica(job('sweep'))

    const firstRun = first.run()
    // Give the first replica time to take the lock before the second asks for it.
    await new Promise((resolve) => setTimeout(resolve, 50))
    const secondOutcome = await second.run()
    release()

    await expect(firstRun).resolves.toBe('succeeded')
    expect(secondOutcome).toBe('skipped')
    expect(peak).toBe(1)

    await first.stop()
    await second.stop()
  })

  it('hands the key on once the first run has finished', async () => {
    const runs: string[] = []
    const job = (replicaName: string): ScheduledJob => ({
      name: 'sweep',
      intervalMs: 60_000,
      lockKey: TEST_LOCK_KEY,
      async run() {
        runs.push(replicaName)
        return {}
      },
    })

    const first = replica(job('first'))
    const second = replica(job('second'))

    await expect(first.run()).resolves.toBe('succeeded')
    await expect(second.run()).resolves.toBe('succeeded')

    expect(runs).toEqual(['first', 'second'])
    await first.stop()
    await second.stop()
  })

  it('releases the key when a run throws, so the next replica is not locked out', async () => {
    const failing = replica({
      name: 'sweep',
      intervalMs: 60_000,
      lockKey: TEST_LOCK_KEY,
      async run() {
        throw new Error('the table was busy')
      },
    })
    const following = replica({
      name: 'sweep',
      intervalMs: 60_000,
      lockKey: TEST_LOCK_KEY,
      async run() {
        return {}
      },
    })

    await expect(failing.run()).resolves.toBe('failed')
    await expect(following.run()).resolves.toBe('succeeded')

    await failing.stop()
    await following.stop()
  })

  it('keeps two different jobs out of each other’s way', async () => {
    const ran: string[] = []
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    const retention = replica({
      name: 'retention',
      intervalMs: 60_000,
      lockKey: TEST_LOCK_KEY,
      async run() {
        ran.push('retention')
        await held
        return {}
      },
    })
    const sweep = replica({
      name: 'sweep',
      intervalMs: 60_000,
      lockKey: TEST_LOCK_KEY + 1,
      async run() {
        ran.push('sweep')
        return {}
      },
    })

    const retentionRun = retention.run()
    await new Promise((resolve) => setTimeout(resolve, 50))
    // A different key, so this one is not held up by the run above.
    await expect(sweep.run()).resolves.toBe('succeeded')
    release()
    await expect(retentionRun).resolves.toBe('succeeded')

    expect(ran).toEqual(['retention', 'sweep'])
    await retention.stop()
    await sweep.stop()
  })
})

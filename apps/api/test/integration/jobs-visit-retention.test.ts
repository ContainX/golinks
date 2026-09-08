// Visit retention against a real database (spec 07 §2.3, spec 09 §1).
//
// The interesting part is not that a delete works but that it works in bounded batches and
// leaves recent history alone, so every case here backdates rows and counts what survives.

import { count, eq, lt } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { links, linkVisits } from '../../src/db/schema/index.ts'
import {
  createVisitRetentionJob,
  DEFAULT_VISIT_RETENTION_INTERVAL_MS,
  sweepExpiredVisits,
  VISIT_RETENTION_BATCH_SIZE,
  VISIT_RETENTION_JOB,
  visitRetentionCutoff,
} from '../../src/jobs/index.ts'
import { createJobScheduler } from '../../src/jobs/scheduler.ts'
import { insertLink, insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets
const DAY_MS = 86_400_000

beforeEach(async () => {
  await resetDatabase()
})

interface Seeded {
  linkId: number
  userId: number
}

async function seedLink(): Promise<Seeded> {
  const { db } = database()
  await insertOrganization(db, ORG)
  const user = await insertUser(db, { email: 'ada@widgets.test', organizationId: ORG })
  const link = await insertLink(db, { organizationId: ORG, ownerId: user.id, keyword: 'handbook' })
  return { linkId: link.id, userId: user.id }
}

/** Writes `total` visits, all of them `daysAgo` days old. */
async function insertVisits(seeded: Seeded, daysAgo: number, total: number): Promise<void> {
  const visitedAt = new Date(Date.now() - daysAgo * DAY_MS)
  const rows = Array.from({ length: total }, () => ({
    linkId: seeded.linkId,
    organizationId: ORG,
    userId: seeded.userId,
    via: 'browser' as const,
    visitedAt,
  }))
  await database().db.insert(linkVisits).values(rows)
}

async function remainingVisits(): Promise<number> {
  const [row] = await database().db.select({ total: count() }).from(linkVisits)
  return row?.total ?? 0
}

describe('the retention cutoff', () => {
  it('is the retention window measured back from now', () => {
    const cutoff = visitRetentionCutoff(365, Date.UTC(2026, 0, 1))
    expect(cutoff.toISOString()).toBe('2025-01-01T00:00:00.000Z')
  })
})

describe('sweeping expired visits', () => {
  it('deletes rows past the window and keeps the recent ones', async () => {
    const seeded = await seedLink()
    await insertVisits(seeded, 400, 6)
    await insertVisits(seeded, 10, 4)

    const report = await sweepExpiredVisits({ db: database().db, retentionDays: 365 })

    expect(report).toMatchObject({ deleted: 6, batches: 1 })
    await expect(remainingVisits()).resolves.toBe(4)
  })

  it('works through more rows than one batch holds, a batch at a time', async () => {
    const seeded = await seedLink()
    await insertVisits(seeded, 400, 7)
    await insertVisits(seeded, 1, 2)

    const report = await sweepExpiredVisits({
      db: database().db,
      retentionDays: 365,
      batchSize: 3,
    })

    // Two full batches of three and a third that comes back short, which is what ends the loop.
    expect(report).toMatchObject({ deleted: 7, batches: 3 })
    await expect(remainingVisits()).resolves.toBe(2)
  })

  it('leaves the counters on the link alone', async () => {
    const seeded = await seedLink()
    await insertVisits(seeded, 400, 3)
    await database().db.update(links).set({ visitCount: 3 }).where(eq(links.id, seeded.linkId))

    await sweepExpiredVisits({ db: database().db, retentionDays: 365 })

    const [row] = await database()
      .db.select({ visitCount: links.visitCount })
      .from(links)
      .where(eq(links.id, seeded.linkId))
    expect(row?.visitCount).toBe(3)
  })

  it('does nothing, in one statement, when there is nothing old enough', async () => {
    const seeded = await seedLink()
    await insertVisits(seeded, 5, 3)

    const report = await sweepExpiredVisits({ db: database().db, retentionDays: 365 })

    expect(report).toMatchObject({ deleted: 0, batches: 1 })
    await expect(remainingVisits()).resolves.toBe(3)
  })

  it('honours a shorter retention window', async () => {
    const seeded = await seedLink()
    await insertVisits(seeded, 10, 2)
    await insertVisits(seeded, 2, 2)

    await sweepExpiredVisits({ db: database().db, retentionDays: 7 })

    const [row] = await database()
      .db.select({ total: count() })
      .from(linkVisits)
      .where(lt(linkVisits.visitedAt, new Date(Date.now() - 7 * DAY_MS)))
    expect(row?.total).toBe(0)
    await expect(remainingVisits()).resolves.toBe(2)
  })
})

describe('the retention job', () => {
  it('is named, hourly, and reports what it deleted through the scheduler', async () => {
    const seeded = await seedLink()
    await insertVisits(seeded, 400, 5)

    const finished: Record<string, unknown>[] = []
    const job = createVisitRetentionJob({ db: database().db, retentionDays: 365 })
    const scheduler = createJobScheduler({
      jobs: [job],
      logger: {
        info: (context, message) => {
          if (message === 'background job finished') finished.push(context)
        },
        warn: () => {},
        error: () => {},
      },
      metrics: { recordJobRun: () => {} },
    })

    expect(job.name).toBe(VISIT_RETENTION_JOB)
    expect(job.intervalMs).toBe(DEFAULT_VISIT_RETENTION_INTERVAL_MS)
    expect(VISIT_RETENTION_BATCH_SIZE).toBe(5_000)

    await expect(scheduler.runOnce(VISIT_RETENTION_JOB)).resolves.toBe('succeeded')
    expect(finished[0]).toMatchObject({ job: VISIT_RETENTION_JOB, deleted: 5, batches: 1 })
    await expect(remainingVisits()).resolves.toBe(0)
    await scheduler.stop()
  })
})

// How the scheduler is wired into a running service (spec 09 §1).
//
// `startBackgroundJobs` is what `index.ts` calls, so what is worth pinning down is the shape of
// what it decides: which jobs exist for this deployment, that `JOBS_ENABLED` can take them all
// away, and that closing the app stops them.

import { count } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { createConfiguredSessionStore } from '../../src/auth/session-stores.ts'
import { linkVisits } from '../../src/db/schema/index.ts'
import type { JobScheduler } from '../../src/jobs/index.ts'
import {
  SESSION_SWEEP_JOB,
  startBackgroundJobs,
  VISIT_RETENTION_JOB,
} from '../../src/jobs/index.ts'
import type { SessionStore } from '../../src/security/session.ts'
import { buildTestApp, testConfig } from '../../src/testing/fixtures.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertLink, insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets

beforeEach(async () => {
  await resetDatabase()
})

interface WiredJobs {
  app: GoLinksApp
  scheduler: JobScheduler | undefined
}

/**
 * A silent app over the harness database with the jobs wired into it the way `index.ts` does:
 * from `plugins`, while the instance is still being built. Fastify refuses new hooks once an
 * app has been made ready, and the scheduler is stopped by an `onClose` hook, so a test cannot
 * attach it afterwards either.
 */
async function appWithJobs(options: {
  sessionStore: SessionStore
  environment?: Record<string, string>
  intervals?: { visitRetentionMs?: number; sessionSweepMs?: number }
}): Promise<WiredJobs> {
  let scheduler: JobScheduler | undefined
  const app = await buildTestApp({
    environment: options.environment ?? {},
    database: database().db,
    plugins: [
      (instance) => {
        scheduler = startBackgroundJobs(instance, {
          db: database().db,
          sql: database().sql,
          sessionStore: options.sessionStore,
          ...(options.intervals === undefined ? {} : { intervals: options.intervals }),
        })
      },
    ],
  })
  return { app, scheduler }
}

const postgresSessions = () =>
  createConfiguredSessionStore(testConfig(), { database: database().db })

describe('starting the background jobs', () => {
  it('schedules retention and the session sweep for a deployment on Postgres sessions', async () => {
    const { app, scheduler } = await appWithJobs({ sessionStore: postgresSessions() })

    expect(scheduler?.jobNames()).toEqual([VISIT_RETENTION_JOB, SESSION_SWEEP_JOB])
    await app.close()
  })

  it('leaves the sweep out when sessions live in Redis', async () => {
    const environment = { REDIS_URL: 'redis://localhost:6379' }
    const { app, scheduler } = await appWithJobs({
      environment,
      sessionStore: createConfiguredSessionStore(testConfig(environment), {
        database: database().db,
        redis: { get: async () => null, set: async () => 'OK', del: async () => 1 },
      }),
    })

    expect(scheduler?.jobNames()).toEqual([VISIT_RETENTION_JOB])
    await app.close()
  })

  it('schedules nothing at all when JOBS_ENABLED is off', async () => {
    const { app, scheduler } = await appWithJobs({
      environment: { JOBS_ENABLED: 'false' },
      sessionStore: postgresSessions(),
    })

    expect(scheduler).toBeUndefined()
    await app.close()
  })

  it('runs the retention job it scheduled, and stops when the app closes', async () => {
    const { db } = database()
    await insertOrganization(db, ORG)
    const user = await insertUser(db, { email: 'ada@widgets.test', organizationId: ORG })
    const link = await insertLink(db, {
      organizationId: ORG,
      ownerId: user.id,
      keyword: 'handbook',
    })
    await db.insert(linkVisits).values({
      linkId: link.id,
      organizationId: ORG,
      userId: user.id,
      via: 'browser',
      visitedAt: new Date(Date.now() - 400 * 86_400_000),
    })

    const { app, scheduler } = await appWithJobs({
      sessionStore: postgresSessions(),
      // Nothing should fire on its own during the test; the run below is explicit.
      intervals: { visitRetentionMs: 3_600_000, sessionSweepMs: 3_600_000 },
    })

    await expect(scheduler?.runOnce(VISIT_RETENTION_JOB)).resolves.toBe('succeeded')

    const [remaining] = await db.select({ total: count() }).from(linkVisits)
    expect(remaining?.total).toBe(0)

    // The onClose hook the wiring registered is what stops the scheduler.
    await app.close()
    await expect(scheduler?.runOnce(VISIT_RETENTION_JOB)).resolves.toBe('succeeded')
  })

  it('counts every run against the service’s own instruments', async () => {
    const { app, scheduler } = await appWithJobs({ sessionStore: postgresSessions() })

    await scheduler?.runOnce(SESSION_SWEEP_JOB)

    const exposition = await app.metrics.render()
    expect(exposition.body).toContain(
      `golinks_job_runs_total{job="${SESSION_SWEEP_JOB}",outcome="succeeded"} 1`,
    )
    await app.close()
  })
})

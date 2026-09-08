// The expired-session sweep against a real database (spec 02 §3, spec 09 §1).

import { count } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  createConfiguredSessionStore,
  createPostgresSessionStore,
} from '../../src/auth/session-stores.ts'
import { sessions } from '../../src/db/schema/index.ts'
import {
  createSessionSweepJob,
  DEFAULT_SESSION_SWEEP_INTERVAL_MS,
  SESSION_SWEEP_JOB,
  sweepableSessionStore,
} from '../../src/jobs/index.ts'
import { createJobScheduler } from '../../src/jobs/scheduler.ts'
import { testConfig } from '../../src/testing/fixtures.ts'
import { insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets

beforeEach(async () => {
  await resetDatabase()
})

async function seedMember(): Promise<number> {
  const { db } = database()
  await insertOrganization(db, ORG)
  const user = await insertUser(db, { email: 'ada@widgets.test', organizationId: ORG })
  return user.id
}

/** Writes one session row whose absolute lifetime ends at `expiresAt`. */
async function insertSession(userId: number, id: string, expiresAt: Date): Promise<void> {
  const nowIso = new Date().toISOString()
  await database()
    .db.insert(sessions)
    .values({
      id,
      userId,
      data: { userId, providerId: 'oidc', createdAt: nowIso, lastSeenAt: nowIso },
      expiresAt,
    })
}

async function remainingSessions(): Promise<number> {
  const [row] = await database().db.select({ total: count() }).from(sessions)
  return row?.total ?? 0
}

const silentLogger = { info: () => {}, warn: () => {}, error: () => {} }

describe('the session sweep', () => {
  it('removes rows past their absolute lifetime and keeps live ones', async () => {
    const userId = await seedMember()
    await insertSession(userId, 'expired-one', new Date(Date.now() - 60_000))
    await insertSession(userId, 'expired-two', new Date(Date.now() - 1_000))
    await insertSession(userId, 'still-live', new Date(Date.now() + 3_600_000))

    const store = createPostgresSessionStore(database().db, { maxAgeMs: 2_592_000_000 })
    const job = createSessionSweepJob({ store })

    const finished: Record<string, unknown>[] = []
    const scheduler = createJobScheduler({
      jobs: [job],
      logger: {
        ...silentLogger,
        info: (context, message) => {
          if (message === 'background job finished') finished.push(context)
        },
      },
      metrics: { recordJobRun: () => {} },
    })

    expect(job.name).toBe(SESSION_SWEEP_JOB)
    expect(job.intervalMs).toBe(DEFAULT_SESSION_SWEEP_INTERVAL_MS)

    await expect(scheduler.runOnce(SESSION_SWEEP_JOB)).resolves.toBe('succeeded')
    expect(finished[0]).toMatchObject({ job: SESSION_SWEEP_JOB, deleted: 2 })
    await expect(remainingSessions()).resolves.toBe(1)
    await scheduler.stop()
  })

  it('reports nothing to do when every session is live', async () => {
    const userId = await seedMember()
    await insertSession(userId, 'live', new Date(Date.now() + 3_600_000))

    const store = createPostgresSessionStore(database().db, { maxAgeMs: 2_592_000_000 })
    await expect(store.sweepExpired()).resolves.toBe(0)
    await expect(remainingSessions()).resolves.toBe(1)
  })
})

describe('deciding whether the sweep exists at all', () => {
  it('recognises the Postgres store as one worth sweeping', () => {
    const store = createConfiguredSessionStore(testConfig(), { database: database().db })
    expect(sweepableSessionStore(store)).toBe(store)
  })

  it('leaves a Redis-backed deployment without a sweep, because Redis expires its own keys', () => {
    const store = createConfiguredSessionStore(
      testConfig({ REDIS_URL: 'redis://localhost:6379' }),
      {
        database: database().db,
        redis: { get: async () => null, set: async () => 'OK', del: async () => 1 },
      },
    )
    expect(sweepableSessionStore(store)).toBeUndefined()
  })
})

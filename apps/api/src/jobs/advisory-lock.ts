// The one-replica-at-a-time guard for scheduled jobs (spec 09 §1).
//
// Every replica of the service runs the same scheduler, so each job has to agree with the
// others about who is running it. Postgres already knows: `pg_try_advisory_lock` either hands
// this session the key or says somebody else holds it, without blocking and without a table of
// our own. The lock is session scoped, so it is taken on a connection reserved for the run and
// released when the run finishes.

import type postgres from 'postgres'

/**
 * The result of asking for a job's key: either the body ran, or another replica was already
 * running it and this replica did nothing at all.
 */
export type JobLockAttempt<T> = { held: true; value: T } | { held: false }

/** How a job asks whether it is the replica that should run. */
export interface JobLock {
  /**
   * Runs `body` while holding `key`, releasing it however the body ends. Returns
   * `{ held: false }` without running anything when the key is already taken.
   */
  hold<T>(key: number, body: () => Promise<T>): Promise<JobLockAttempt<T>>
}

/**
 * The real lock. Reserves a connection so that the `pg_try_advisory_lock` and the matching
 * `pg_advisory_unlock` are issued on the same session, which is the only way a session-scoped
 * lock survives a pooled query in between.
 */
export function createAdvisoryJobLock(sql: postgres.Sql): JobLock {
  return {
    async hold(key, body) {
      const reserved = await sql.reserve()
      try {
        const rows = await reserved<{ acquired: boolean }[]>`
          select pg_try_advisory_lock(${key}) as acquired
        `
        if (rows[0]?.acquired !== true) return { held: false }

        try {
          return { held: true, value: await body() }
        } finally {
          await reserved`select pg_advisory_unlock(${key})`
        }
      } finally {
        reserved.release()
      }
    },
  }
}

/**
 * A lock that always grants. The scheduler is useful without a database — a unit test drives
 * it with fake jobs — and this is what it falls back to.
 */
export const alwaysGrantedJobLock: JobLock = {
  async hold(_key, body) {
    return { held: true, value: await body() }
  },
}

/** A lock that never grants, for a test that wants the skipped path. */
export const neverGrantedJobLock: JobLock = {
  async hold() {
    return { held: false }
  },
}

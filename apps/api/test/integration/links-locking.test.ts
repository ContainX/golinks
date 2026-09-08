// The keyword advisory lock against a real Postgres (spec 03 §6.1).

import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { keywordLockKey, withKeywordLock } from '../../src/links/index.ts'
import { TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets

const JIRA = { organizationId: ORG, namespace: 'go', prefix: 'jira' }
const GITHUB = { organizationId: ORG, namespace: 'go', prefix: 'gh' }

beforeEach(async () => {
  await resetDatabase()
})

/** A promise and the function that settles it, for choreographing two transactions. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open: () => void = () => {}
  const wait = new Promise<void>((resolve) => {
    open = resolve
  })
  return { wait, open }
}

describe('withKeywordLock', () => {
  it('holds the advisory lock for the triple while the work runs', async () => {
    const key = keywordLockKey(JIRA)
    // A single-argument advisory lock is recorded as its high and low 32-bit halves.
    const unsigned = BigInt.asUintN(64, key)
    const classId = Number(unsigned >> 32n)
    const objectId = Number(unsigned & 0xffffffffn)

    const held = await withKeywordLock(database().db, JIRA, async (tx) => {
      const rows = await tx.execute(sql`
        select count(*)::int as held
        from pg_locks
        where locktype = 'advisory'
          and granted
          and classid = ${classId}
          and objid = ${objectId}
      `)
      return (rows as unknown as { held: number }[])[0]?.held ?? 0
    })

    expect(held).toBe(1)
  })

  it('releases the lock when the transaction ends, even in failure', async () => {
    await expect(
      withKeywordLock(database().db, JIRA, async () => {
        throw new Error('the write failed')
      }),
    ).rejects.toThrow('the write failed')

    // A second attempt on the same triple goes straight through rather than waiting.
    await expect(withKeywordLock(database().db, JIRA, async () => 'through')).resolves.toBe(
      'through',
    )
  })

  it('makes a second writer on the same triple wait for the first', async () => {
    const order: string[] = []
    const first = gate()
    const entered = gate()

    const leading = withKeywordLock(database().db, JIRA, async () => {
      order.push('first in')
      entered.open()
      await first.wait
      order.push('first out')
    })

    await entered.wait
    const following = withKeywordLock(database().db, JIRA, async () => {
      order.push('second in')
    })

    // Give the second transaction every chance to run ahead if the lock did not hold it.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(order).toEqual(['first in'])

    first.open()
    await Promise.all([leading, following])
    expect(order).toEqual(['first in', 'first out', 'second in'])
  })

  it('lets two writers on different prefixes run side by side', async () => {
    const jira = gate()
    const github = gate()

    // Each waits for the other to be inside its transaction, so this only settles if the
    // two locks are genuinely independent.
    await Promise.all([
      withKeywordLock(database().db, JIRA, async () => {
        jira.open()
        await github.wait
      }),
      withKeywordLock(database().db, GITHUB, async () => {
        github.open()
        await jira.wait
      }),
    ])
  })
})

// Visit recording against a real database (spec 04 §6, spec 07 §2): the counters on the link,
// the row in `link_visits`, and the promise that a failure never reaches the member.

import { asc, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { links, linkVisits } from '../../src/db/schema/index.ts'
import { createVisitRecorder } from '../../src/resolver/visits.ts'
import { buildTestApp } from '../../src/testing/fixtures.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { RESOLVER_ORGANIZATION, seedExampleOrganization } from './resolver-fixtures.ts'

const database = useTestDatabase()

beforeEach(async () => {
  await resetDatabase()
})

interface Scenario {
  app: GoLinksApp
  handbookId: number
  memberId: number
}

async function scenario(plugins: readonly ((app: GoLinksApp) => void)[] = []): Promise<Scenario> {
  const { db } = database()
  const seeded = await seedExampleOrganization(db)
  const app = await buildTestApp({
    database: db,
    memberResolver: async () => seeded.member,
    plugins,
  })
  return {
    app,
    handbookId: seeded.linkIds.get('handbook') ?? 0,
    memberId: Number(seeded.member.id),
  }
}

function counters(app: GoLinksApp, linkId: number) {
  return app.db
    .select({ visitCount: links.visitCount, lastVisitedAt: links.lastVisitedAt })
    .from(links)
    .where(eq(links.id, linkId))
}

function visitsOf(app: GoLinksApp) {
  return app.db.select().from(linkVisits).orderBy(asc(linkVisits.id))
}

describe('recording a visit', () => {
  it('bumps the counters and appends a row once the redirect has been sent', async () => {
    const { app, handbookId, memberId } = await scenario()

    const response = await app.inject({ method: 'GET', url: '/handbook' })
    await app.visitRecorder.settled()

    expect(response.statusCode).toBe(302)
    const [counter] = await counters(app, handbookId)
    expect(counter?.visitCount).toBe(1)
    expect(counter?.lastVisitedAt).toBeInstanceOf(Date)

    const visits = await visitsOf(app)
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({
      linkId: handbookId,
      organizationId: RESOLVER_ORGANIZATION,
      userId: memberId,
      via: 'browser',
    })

    await app.close()
  })

  it('counts every hit', async () => {
    const { app, handbookId } = await scenario()

    await app.inject({ method: 'GET', url: '/handbook' })
    await app.inject({ method: 'GET', url: '/Handbook' })
    await app.inject({ method: 'GET', url: '/handbook/' })
    await app.visitRecorder.settled()

    const [counter] = await counters(app, handbookId)
    expect(counter?.visitCount).toBe(3)
    expect(await visitsOf(app)).toHaveLength(3)

    await app.close()
  })

  it('takes the access source from the via parameter', async () => {
    const { app } = await scenario()

    await app.inject({ method: 'GET', url: '/handbook?via=search' })
    await app.inject({ method: 'GET', url: '/handbook?via=ext' })
    await app.inject({ method: 'GET', url: '/handbook?via=api' })
    await app.inject({ method: 'GET', url: '/handbook?via=telepathy' })
    await app.inject({ method: 'GET', url: '/handbook?utm_source=slack' })
    await app.visitRecorder.settled()

    expect((await visitsOf(app)).map((visit) => visit.via)).toEqual([
      'search',
      'ext',
      'api',
      'browser',
      'browser',
    ])

    await app.close()
  })

  it('records nothing for a miss', async () => {
    const { app } = await scenario()

    const response = await app.inject({ method: 'GET', url: '/nothing-here' })
    await app.visitRecorder.settled()

    expect(response.statusCode).toBe(302)
    expect(await visitsOf(app)).toHaveLength(0)

    await app.close()
  })

  it('leaves the redirect untouched when the writes fail', async () => {
    const { app, handbookId } = await scenario([
      (instance) => {
        instance.decorate(
          'visitRecorder',
          createVisitRecorder({
            write: async () => {
              throw new Error('the visit store is down')
            },
          }),
        )
      },
    ])

    const response = await app.inject({ method: 'GET', url: '/handbook' })
    await app.visitRecorder.settled()

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('https://wiki.acme.com/handbook')
    const [counter] = await counters(app, handbookId)
    expect(counter?.visitCount).toBe(0)
    expect(await visitsOf(app)).toHaveLength(0)

    await app.close()
  })

  it('records a programmatic hit against the link that matched', async () => {
    const { app } = await scenario()
    const { db } = database()
    const [jira] = await db.select().from(links).where(eq(links.keyword, 'jira/%s'))

    await app.inject({ method: 'GET', url: '/jira/ACME-1?via=search' })
    await app.visitRecorder.settled()

    const visits = await visitsOf(app)
    expect(visits[0]).toMatchObject({ linkId: jira?.id, via: 'search' })

    await app.close()
  })
})

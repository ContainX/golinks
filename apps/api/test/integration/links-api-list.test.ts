// `GET /_/api/v1/links` (spec 05 §3, spec 03 §10.1).
//
// The directory is the one endpoint where a mistake is silent: a filter that widens instead of
// narrowing hands out an unlisted link, and a cursor that drifts drops rows off the end of a
// page without anybody noticing. Both are checked here against real rows.

import { API_BASE_PATH, type Link, LinkListResponseSchema } from '@golinks/shared/api'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type LinkRow, links } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertLink, insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  applySettings,
  buildLinksApp,
  errorCodeOf,
  type SignedInMember,
  signInMember,
} from './links-fixtures.ts'

const database = useTestDatabase()
const LINKS_URL = `${API_BASE_PATH}/links`
const WIDGETS = TEST_ORGANIZATION_IDS.widgets
const GIZMOS = TEST_ORGANIZATION_IDS.gizmos

let app: GoLinksApp
let ada: SignedInMember
let grace: SignedInMember
let linus: SignedInMember

beforeEach(async () => {
  await resetDatabase()
  app = await buildLinksApp(database().db)
  ada = await signInMember(app, database().db, { email: `ada@${WIDGETS}` })
  grace = await signInMember(app, database().db, { email: `grace@${WIDGETS}`, admin: true })
  linus = await signInMember(app, database().db, { email: `linus@${WIDGETS}` })
})

afterEach(async () => {
  await app.close()
})

interface SeedOptions {
  keyword: string
  owner?: SignedInMember
  namespace?: string
  displayKeyword?: string
  destination?: string
  isUnlisted?: boolean
  visitCount?: number
  createdAt?: string
  updatedAt?: string
  organizationId?: string
  ownerId?: number
}

/** One stored link, placed precisely on the axes the directory sorts by. */
async function seed(options: SeedOptions): Promise<LinkRow> {
  const { db } = database()
  const row = await insertLink(db, {
    organizationId: options.organizationId ?? WIDGETS,
    ownerId: options.ownerId ?? options.owner?.user.id ?? ada.user.id,
    keyword: options.keyword,
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.displayKeyword === undefined ? {} : { displayKeyword: options.displayKeyword }),
    ...(options.destination === undefined ? {} : { destination: options.destination }),
    ...(options.isUnlisted === undefined ? {} : { isUnlisted: options.isUnlisted }),
  })

  const patch = {
    ...(options.visitCount === undefined ? {} : { visitCount: options.visitCount }),
    ...(options.createdAt === undefined ? {} : { createdAt: new Date(options.createdAt) }),
    ...(options.updatedAt === undefined ? {} : { updatedAt: new Date(options.updatedAt) }),
  }
  if (Object.keys(patch).length === 0) return row

  const [updated] = await database()
    .db.update(links)
    .set(patch)
    .where(eq(links.id, row.id))
    .returning()
  if (updated === undefined) throw new Error('Placing the seeded link returned no row.')
  return updated
}

async function list(who: SignedInMember, query = ''): Promise<Link[]> {
  const response = await app.inject({
    method: 'GET',
    url: query.length === 0 ? LINKS_URL : `${LINKS_URL}?${query}`,
    headers: who.headers,
  })
  expect(response.statusCode).toBe(200)
  return LinkListResponseSchema.parse(response.json()).items
}

function paths(items: readonly Link[]): string[] {
  return items.map((item) => item.fullPath)
}

describe('the page envelope', () => {
  it('answers with the shape the shared schema describes', async () => {
    await seed({ keyword: 'handbook' })

    const response = await app.inject({ method: 'GET', url: LINKS_URL, headers: ada.headers })

    expect(response.statusCode).toBe(200)
    const parsed = LinkListResponseSchema.safeParse(response.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.data?.nextCursor).toBeNull()
  })

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await app.inject({ method: 'GET', url: LINKS_URL })

    expect(response.statusCode).toBe(401)
    expect(errorCodeOf(response)).toBe('unauthenticated')
  })

  it('rejects a limit past the maximum', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?limit=500`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })

  it('rejects an unknown query parameter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?colour=red`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })
})

describe('filters', () => {
  it('matches q against the display keyword, case-insensitively', async () => {
    await seed({ keyword: 'meetingnotes', displayKeyword: 'meeting-notes' })
    await seed({ keyword: 'payroll' })

    expect(paths(await list(ada, 'q=MEETING'))).toEqual(['go/meeting-notes'])
  })

  it('matches q against the destination', async () => {
    await seed({ keyword: 'handbook', destination: 'https://wiki.widgets.test/handbook' })
    await seed({ keyword: 'payroll', destination: 'https://payments.widgets.test/' })

    expect(paths(await list(ada, 'q=payments'))).toEqual(['go/payroll'])
  })

  it("matches q against the owner's email", async () => {
    await seed({ keyword: 'handbook', owner: ada })
    await seed({ keyword: 'payroll', owner: linus })

    expect(paths(await list(ada, 'q=linus'))).toEqual(['go/payroll'])
  })

  it('treats a wildcard in q as an ordinary character', async () => {
    await seed({ keyword: 'handbook' })
    await seed({ keyword: 'payroll' })

    expect(await list(ada, 'q=%25')).toEqual([])
  })

  it('restricts to one namespace', async () => {
    await seed({ keyword: 'deploy', namespace: 'eng' })
    await seed({ keyword: 'handbook' })

    expect(paths(await list(ada, 'namespace=eng'))).toEqual(['eng/deploy'])
  })

  it('restricts to the caller with owner=me', async () => {
    await seed({ keyword: 'handbook', owner: ada })
    await seed({ keyword: 'payroll', owner: linus })

    expect(paths(await list(ada, 'owner=me'))).toEqual(['go/handbook'])
  })

  it('restricts to a named member', async () => {
    await seed({ keyword: 'handbook', owner: ada })
    await seed({ keyword: 'payroll', owner: linus })

    expect(paths(await list(ada, `owner=${linus.user.id}`))).toEqual(['go/payroll'])
  })

  it('finds nothing for an owner id that is not one of ours', async () => {
    await seed({ keyword: 'handbook' })

    expect(await list(ada, 'owner=nobody')).toEqual([])
  })

  it('separates programmatic links from plain ones', async () => {
    await seed({ keyword: 'jira/%s' })
    await seed({ keyword: 'handbook' })

    expect(paths(await list(ada, 'programmatic=true'))).toEqual(['go/jira/%s'])
    expect(paths(await list(ada, 'programmatic=false'))).toEqual(['go/handbook'])
    expect(paths(await list(ada, 'sort=keyword&order=asc'))).toEqual(['go/handbook', 'go/jira/%s'])
  })

  it('rejects a programmatic value that is not a boolean', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?programmatic=maybe`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })
})

describe('the destination filter (spec 03 §10.1, spec 12 §3)', () => {
  const PAGE = 'https://wiki.widgets.test/handbook'

  /** `GET /links?destination=…` with the value escaped the way the extension sends it. */
  function forDestination(destination: string): string {
    return `destination=${encodeURIComponent(destination)}`
  }

  it('answers with the link whose destination matches exactly', async () => {
    await seed({ keyword: 'handbook', destination: PAGE })
    await seed({ keyword: 'payroll', destination: 'https://payments.widgets.test/' })

    expect(paths(await list(ada, forDestination(PAGE)))).toEqual(['go/handbook'])
  })

  it('answers with every link that points at the same page', async () => {
    await seed({ keyword: 'handbook', destination: PAGE })
    await seed({ keyword: 'onboarding', destination: PAGE, owner: linus })

    expect(paths(await list(ada, `${forDestination(PAGE)}&sort=keyword&order=asc`))).toEqual([
      'go/handbook',
      'go/onboarding',
    ])
  })

  it('does not answer a prefix, a suffix, or a different fragment', async () => {
    await seed({ keyword: 'handbook', destination: PAGE })

    expect(await list(ada, forDestination('https://wiki.widgets.test'))).toEqual([])
    expect(await list(ada, forDestination(`${PAGE}/`))).toEqual([])
    expect(await list(ada, forDestination(`${PAGE}#leave`))).toEqual([])
    expect(await list(ada, forDestination(`${PAGE}?print=1`))).toEqual([])
  })

  it('treats a wildcard in the destination as an ordinary character', async () => {
    await seed({ keyword: 'handbook', destination: PAGE })

    expect(await list(ada, forDestination('%'))).toEqual([])
  })

  it('combines with the other filters rather than widening the page', async () => {
    await seed({ keyword: 'handbook', destination: PAGE, owner: ada })
    await seed({ keyword: 'onboarding', destination: PAGE, owner: linus })

    expect(paths(await list(ada, `${forDestination(PAGE)}&owner=me`))).toEqual(['go/handbook'])
    expect(await list(ada, `${forDestination(PAGE)}&namespace=eng`)).toEqual([])
  })

  it('keeps the unlisted rule over the match (spec 03 §4)', async () => {
    await seed({ keyword: 'secret', destination: PAGE, owner: ada, isUnlisted: true })

    expect(paths(await list(ada, forDestination(PAGE)))).toEqual(['go/secret'])
    expect(paths(await list(grace, forDestination(PAGE)))).toEqual(['go/secret'])
    expect(await list(linus, forDestination(PAGE))).toEqual([])
  })

  it('never reaches another organization', async () => {
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await insertUser(db, { email: `zoe@${GIZMOS}`, organizationId: GIZMOS })
    await seed({
      keyword: 'handbook',
      destination: PAGE,
      organizationId: GIZMOS,
      ownerId: stranger.id,
    })

    expect(await list(ada, forDestination(PAGE))).toEqual([])
    expect(await list(grace, forDestination(PAGE))).toEqual([])
  })

  it('rejects an empty destination rather than reading it as no filter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?destination=`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })
})

describe('sorting', () => {
  beforeEach(async () => {
    await seed({
      keyword: 'alpha',
      visitCount: 5,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    })
    await seed({
      keyword: 'bravo',
      visitCount: 90,
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    })
    await seed({
      keyword: 'charlie',
      visitCount: 40,
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    })
  })

  it('puts the busiest links first by default', async () => {
    expect(paths(await list(ada))).toEqual(['go/bravo', 'go/charlie', 'go/alpha'])
  })

  it('turns the default order around', async () => {
    expect(paths(await list(ada, 'order=asc'))).toEqual(['go/alpha', 'go/charlie', 'go/bravo'])
  })

  it('sorts by keyword', async () => {
    expect(paths(await list(ada, 'sort=keyword&order=asc'))).toEqual([
      'go/alpha',
      'go/bravo',
      'go/charlie',
    ])
    expect(paths(await list(ada, 'sort=keyword&order=desc'))).toEqual([
      'go/charlie',
      'go/bravo',
      'go/alpha',
    ])
  })

  it('sorts by creation time', async () => {
    expect(paths(await list(ada, 'sort=created&order=desc'))).toEqual([
      'go/charlie',
      'go/bravo',
      'go/alpha',
    ])
  })

  it('sorts by the last change', async () => {
    expect(paths(await list(ada, 'sort=updated&order=desc'))).toEqual([
      'go/alpha',
      'go/charlie',
      'go/bravo',
    ])
  })

  it('rejects a sort it does not offer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?sort=popularity`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })
})

describe('cursor paging', () => {
  /** Reads the whole collection one page at a time and returns what it saw, in order. */
  async function readAllPages(who: SignedInMember, query: string): Promise<string[]> {
    const seen: string[] = []
    let cursor: string | null = null

    for (let page = 0; page < 20; page += 1) {
      const url: string =
        cursor === null
          ? `${LINKS_URL}?${query}`
          : `${LINKS_URL}?${query}&cursor=${encodeURIComponent(cursor)}`
      const response = await app.inject({ method: 'GET', url, headers: who.headers })
      expect(response.statusCode).toBe(200)
      const body = LinkListResponseSchema.parse(response.json())
      seen.push(...paths(body.items))
      cursor = body.nextCursor
      if (cursor === null) return seen
    }
    throw new Error('The cursor never ran out of pages.')
  }

  it('walks every link exactly once under the default visits-descending sort', async () => {
    // Every link has the same visit count, which is the case a cursor carrying only the sort
    // value would get wrong: without the id the second page would start again from the top.
    for (const keyword of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
      await seed({ keyword, visitCount: 7 })
    }

    const seen = await readAllPages(ada, 'limit=2')

    expect(seen).toHaveLength(5)
    expect(new Set(seen).size).toBe(5)
    expect(seen).toEqual(paths(await list(ada, 'limit=200')))
  })

  it('walks every link exactly once under each sort', async () => {
    await seed({ keyword: 'alpha', visitCount: 3, createdAt: '2026-01-01T00:00:00Z' })
    await seed({ keyword: 'bravo', visitCount: 3, createdAt: '2026-01-02T00:00:00Z' })
    await seed({ keyword: 'charlie', visitCount: 9, createdAt: '2026-01-03T00:00:00Z' })

    for (const sort of ['visits', 'keyword', 'created', 'updated']) {
      for (const order of ['asc', 'desc']) {
        const paged = await readAllPages(ada, `limit=1&sort=${sort}&order=${order}`)
        const whole = paths(await list(ada, `limit=200&sort=${sort}&order=${order}`))
        expect(paged, `${sort} ${order}`).toEqual(whole)
      }
    }
  })

  it('stops handing out a cursor on the last page', async () => {
    await seed({ keyword: 'alpha' })
    await seed({ keyword: 'bravo' })

    const first = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?limit=1`,
      headers: ada.headers,
    })
    const firstBody = LinkListResponseSchema.parse(first.json())
    expect(firstBody.nextCursor).not.toBeNull()

    const second = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor ?? '')}`,
      headers: ada.headers,
    })
    expect(LinkListResponseSchema.parse(second.json()).nextCursor).toBeNull()
  })

  it('refuses a cursor that did not come from this endpoint', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?cursor=not-a-cursor`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })

  it('refuses a cursor from a page that was sorted differently', async () => {
    await seed({ keyword: 'alpha' })
    await seed({ keyword: 'bravo' })

    const first = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?limit=1&sort=keyword&order=asc`,
      headers: ada.headers,
    })
    const cursor = LinkListResponseSchema.parse(first.json()).nextCursor ?? ''

    const response = await app.inject({
      method: 'GET',
      url: `${LINKS_URL}?limit=1&sort=created&order=asc&cursor=${encodeURIComponent(cursor)}`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })
})

describe('unlisted visibility (spec 03 §4)', () => {
  beforeEach(async () => {
    await seed({ keyword: 'handbook', owner: ada })
    await seed({ keyword: 'secret', owner: ada, isUnlisted: true })
    await seed({ keyword: 'payroll', owner: linus, isUnlisted: true })
  })

  it('shows an owner their own unlisted link and nobody else', async () => {
    expect(paths(await list(ada, 'sort=keyword&order=asc'))).toEqual(['go/handbook', 'go/secret'])
  })

  it('shows an admin every unlisted link in the organization', async () => {
    expect(paths(await list(grace, 'sort=keyword&order=asc'))).toEqual([
      'go/handbook',
      'go/payroll',
      'go/secret',
    ])
  })

  it('hides an unlisted link from another member', async () => {
    expect(paths(await list(linus, 'sort=keyword&order=asc'))).toEqual([
      'go/handbook',
      'go/payroll',
    ])
  })

  it('keeps an unlisted link out of a search that would otherwise match it', async () => {
    expect(await list(linus, 'q=secret')).toEqual([])
    expect(paths(await list(grace, 'q=secret'))).toEqual(['go/secret'])
  })
})

describe('permissions travel with every link (spec 03 §10.1)', () => {
  it('answers each caller with their own permissions', async () => {
    await seed({ keyword: 'handbook', owner: ada })

    const [asOwner] = await list(ada)
    const [asAdmin] = await list(grace)
    const [asBystander] = await list(linus)

    expect(asOwner?.permissions).toEqual({
      canEditDestination: true,
      canEdit: true,
      canDelete: true,
      canTransfer: true,
    })
    expect(asAdmin?.permissions).toEqual(asOwner?.permissions)
    expect(asBystander?.permissions).toEqual({
      canEditDestination: false,
      canEdit: false,
      canDelete: false,
      canTransfer: false,
    })
  })

  it('opens destination edits to every member when editMode is anyMember', async () => {
    await applySettings(app, WIDGETS, { editMode: 'anyMember' })
    await seed({ keyword: 'handbook', owner: ada })

    const [asBystander] = await list(linus)

    expect(asBystander?.permissions).toEqual({
      canEditDestination: true,
      canEdit: false,
      canDelete: false,
      canTransfer: false,
    })
  })

  it('withdraws every write from a member while the organization is read-only', async () => {
    await applySettings(app, WIDGETS, { readOnly: true })
    await seed({ keyword: 'handbook', owner: ada })

    const [asOwner] = await list(ada)
    const [asAdmin] = await list(grace)

    expect(asOwner?.permissions).toEqual({
      canEditDestination: false,
      canEdit: false,
      canDelete: false,
      canTransfer: false,
    })
    expect(asAdmin?.permissions.canEdit).toBe(true)
  })
})

describe('isolation between organizations', () => {
  it('never shows a link from another organization', async () => {
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await insertUser(db, { email: `zoe@${GIZMOS}`, organizationId: GIZMOS })
    await seed({ keyword: 'handbook', owner: ada })
    await seed({ keyword: 'handbook', organizationId: GIZMOS, ownerId: stranger.id })

    const items = await list(grace)

    expect(items).toHaveLength(1)
    expect(items[0]?.owner.email).toBe(ada.user.email)
  })
})

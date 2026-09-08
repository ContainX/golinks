// `GET /_/api/v1/links/suggestions` (spec 05 §3, spec 03 §10.2).
//
// Where the resolver's miss flow sends a member who typed a keyword that is nearly right. The
// ranking is trigram similarity in Postgres, so it is worth proving against real rows that a
// near miss comes back ahead of a further one and that an unrelated keyword comes back at all.

import {
  API_BASE_PATH,
  type Link,
  LinkSuggestionsResponseSchema,
  MAX_SUGGESTION_LIMIT,
} from '@golinks/shared/api'
import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
const SUGGESTIONS_URL = `${API_BASE_PATH}/links/suggestions`
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
  displayKeyword?: string
  namespace?: string
  owner?: SignedInMember
  isUnlisted?: boolean
  organizationId?: string
  ownerId?: number
}

async function seed(options: SeedOptions): Promise<void> {
  await insertLink(database().db, {
    organizationId: options.organizationId ?? WIDGETS,
    ownerId: options.ownerId ?? options.owner?.user.id ?? ada.user.id,
    keyword: options.keyword,
    ...(options.displayKeyword === undefined ? {} : { displayKeyword: options.displayKeyword }),
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.isUnlisted === undefined ? {} : { isUnlisted: options.isUnlisted }),
  })
}

async function suggest(who: SignedInMember, query: string): Promise<Link[]> {
  const response = await app.inject({
    method: 'GET',
    url: `${SUGGESTIONS_URL}?${query}`,
    headers: who.headers,
  })
  expect(response.statusCode).toBe(200)
  return LinkSuggestionsResponseSchema.parse(response.json()).items
}

function paths(items: readonly Link[]): string[] {
  return items.map((item) => item.fullPath)
}

describe('ranking near misses', () => {
  beforeEach(async () => {
    await seed({ keyword: 'handbook' })
    await seed({ keyword: 'handbrake' })
    await seed({ keyword: 'payroll' })
  })

  it('puts the closest keyword first and leaves an unrelated one out', async () => {
    const items = await suggest(ada, 'keyword=handbok')

    expect(paths(items)).toEqual(['go/handbook', 'go/handbrake'])
  })

  it('never suggests the exact keyword that was asked for', async () => {
    const items = await suggest(ada, 'keyword=handbook')

    expect(paths(items)).toEqual(['go/handbrake'])
  })

  it('answers nothing at all when nothing is close', async () => {
    expect(await suggest(ada, 'keyword=zzzzzzzz')).toEqual([])
  })

  it('answers the resource the shared schema describes, permissions and all', async () => {
    const [first] = await suggest(ada, 'keyword=handbok')

    expect(first).toMatchObject({
      fullPath: 'go/handbook',
      owner: { email: ada.user.email },
      permissions: { canEdit: true },
    })
  })

  it('honours a smaller limit and defaults to five', async () => {
    expect(await suggest(ada, 'keyword=handbok&limit=1')).toHaveLength(1)
    for (const keyword of ['handbooks', 'handbooking', 'handbooked', 'handbookish']) {
      await seed({ keyword })
    }
    expect((await suggest(ada, 'keyword=handbok')).length).toBeLessThanOrEqual(5)
  })

  it('is reached as itself rather than as a link id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SUGGESTIONS_URL}?keyword=handbok`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(200)
  })
})

describe('scope', () => {
  it('searches the default namespace unless another is named', async () => {
    await seed({ keyword: 'deploy', namespace: 'eng' })
    await seed({ keyword: 'deployment' })

    expect(paths(await suggest(ada, 'keyword=deploi'))).toEqual(['go/deployment'])
    expect(paths(await suggest(ada, 'keyword=deploi&namespace=eng'))).toEqual(['eng/deploy'])
  })

  it('compares canonical keywords in a punctuation-insensitive organization', async () => {
    await applySettings(app, WIDGETS, {
      keywords: { ...DEFAULT_ORGANIZATION_SETTINGS.keywords, punctuationSensitive: false },
    })
    await seed({ keyword: 'meetingnotes', displayKeyword: 'meeting-notes' })

    // The canonical form of what was typed is `meetingnote`, a near miss for `meetingnotes`.
    expect(paths(await suggest(ada, 'keyword=meeting-note'))).toEqual(['go/meeting-notes'])
    // And the canonical form of the whole keyword is an exact match, so it is not suggested.
    expect(await suggest(ada, 'keyword=meeting-notes')).toEqual([])
  })

  it('never suggests a link from another organization', async () => {
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await insertUser(db, { email: `zoe@${GIZMOS}`, organizationId: GIZMOS })
    await seed({ keyword: 'handbook', organizationId: GIZMOS, ownerId: stranger.id })

    expect(await suggest(ada, 'keyword=handbok')).toEqual([])
  })
})

describe('unlisted visibility (spec 03 §4)', () => {
  beforeEach(async () => {
    await seed({ keyword: 'handbook', owner: ada, isUnlisted: true })
  })

  it('suggests an unlisted link to its owner', async () => {
    expect(paths(await suggest(ada, 'keyword=handbok'))).toEqual(['go/handbook'])
  })

  it('suggests an unlisted link to an admin', async () => {
    expect(paths(await suggest(grace, 'keyword=handbok'))).toEqual(['go/handbook'])
  })

  it('keeps an unlisted link out of another member’s suggestions', async () => {
    expect(await suggest(linus, 'keyword=handbok')).toEqual([])
  })
})

describe('what the endpoint refuses', () => {
  it('needs a keyword', async () => {
    const response = await app.inject({
      method: 'GET',
      url: SUGGESTIONS_URL,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })

  it('caps how many suggestions may be asked for', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SUGGESTIONS_URL}?keyword=handbook&limit=${MAX_SUGGESTION_LIMIT + 1}`,
      headers: ada.headers,
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })

  it('suggests nothing for a path that is not a keyword at all', async () => {
    await seed({ keyword: 'handbook' })

    // The miss flow sends whatever the member opened, which need not normalize to anything.
    expect(await suggest(ada, 'keyword=%2F%2F%2F')).toEqual([])
  })

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `${SUGGESTIONS_URL}?keyword=handbook`,
    })

    expect(response.statusCode).toBe(401)
    expect(errorCodeOf(response)).toBe('unauthenticated')
  })
})

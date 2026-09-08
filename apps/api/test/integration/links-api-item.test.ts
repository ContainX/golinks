// `GET`, `PATCH` and `DELETE /_/api/v1/links/:id` (spec 05 §3, spec 03 §5, §7, §8).
//
// The permission table of spec 03 §5 is written out here as data and driven through HTTP, cell
// by cell, under each of the three settings that bend it: the ordinary organization, one where
// `editMode` is `anyMember`, and one that is read-only.

import { API_BASE_PATH, LinkSchema } from '@golinks/shared/api'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type LinkRow, links, users } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertLink, insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  applySettings,
  buildLinksApp,
  type ErrorEnvelopeBody,
  errorCodeOf,
  readAuditEvents,
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
  keyword?: string
  owner?: SignedInMember
  isUnlisted?: boolean
  organizationId?: string
  ownerId?: number
}

async function seed(options: SeedOptions = {}): Promise<LinkRow> {
  return await insertLink(database().db, {
    organizationId: options.organizationId ?? WIDGETS,
    ownerId: options.ownerId ?? options.owner?.user.id ?? ada.user.id,
    keyword: options.keyword ?? 'handbook',
    destination: 'https://wiki.widgets.test/handbook',
    ...(options.isUnlisted === undefined ? {} : { isUnlisted: options.isUnlisted }),
  })
}

function get(who: SignedInMember, id: number | string) {
  return app.inject({ method: 'GET', url: `${LINKS_URL}/${id}`, headers: who.headers })
}

function patch(who: SignedInMember, id: number | string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `${LINKS_URL}/${id}`,
    headers: who.apiHeaders,
    payload,
  })
}

/** A delete carries no body, so it carries no content type either; the Origin still applies. */
function remove(who: SignedInMember, id: number | string) {
  return app.inject({
    method: 'DELETE',
    url: `${LINKS_URL}/${id}`,
    headers: { cookie: who.session.cookie, origin: app.appConfig.baseUrl },
  })
}

describe('reading one link', () => {
  it('answers with the resource the shared schema describes', async () => {
    const link = await seed()

    const response = await get(ada, link.id)

    expect(response.statusCode).toBe(200)
    const parsed = LinkSchema.safeParse(response.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.data).toMatchObject({
      id: String(link.id),
      fullPath: 'go/handbook',
      owner: { email: ada.user.email },
    })
  })

  it('computes the permissions for whoever asked', async () => {
    const link = await seed({ owner: ada })

    expect((await get(linus, link.id)).json()).toMatchObject({
      permissions: { canEdit: false, canDelete: false, canTransfer: false },
    })
    expect((await get(grace, link.id)).json()).toMatchObject({
      permissions: { canEdit: true, canDelete: true, canTransfer: true },
    })
  })

  it('answers with an unlisted link that the member could resolve anyway', async () => {
    // Spec 03 §4 keeps an unlisted link out of the directory, search, and suggestions. Asking
    // for one by id is none of those, and every member of the organization can resolve it and
    // see the same destination, so withholding it here would hide nothing.
    const link = await seed({ owner: ada, isUnlisted: true })

    const response = await get(linus, link.id)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ isUnlisted: true, permissions: { canEdit: false } })
  })

  it('answers 404 for an id that belongs to another organization', async () => {
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await insertUser(db, { email: `zoe@${GIZMOS}`, organizationId: GIZMOS })
    const theirs = await seed({ organizationId: GIZMOS, ownerId: stranger.id })

    const response = await get(grace, theirs.id)

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('not_found')
  })

  it.each([
    ['an id nothing is stored under', '999999'],
    ['an id that is not a number', 'handbook'],
  ])('answers 404 for %s', async (_case, id) => {
    const response = await get(ada, id)

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('not_found')
  })

  it('refuses an unauthenticated caller with 401', async () => {
    const link = await seed()

    const response = await app.inject({ method: 'GET', url: `${LINKS_URL}/${link.id}` })

    expect(response.statusCode).toBe(401)
    expect(errorCodeOf(response)).toBe('unauthenticated')
  })
})

// --- the permission table of spec 03 §5 -------------------------------------

/** The organization settings a row of the table is judged under. */
type Regime = 'ownersAndAdmins' | 'anyMember' | 'readOnly'

/** The kinds of change the table distinguishes. */
type Change = 'destination' | 'keyword' | 'namespace' | 'unlisted' | 'owner' | 'delete'

type Caller = 'owner' | 'admin' | 'bystander'

/** Either the status a permitted request answers with, or the code that refused it. */
type Outcome = 200 | 204 | 'forbidden' | 'read_only'

/**
 * Spec 03 §5, written out. Owner and admin manage everything; another member may only touch a
 * destination, and only when `editMode` says so. Setting an owner outright is an admin's alone
 * (spec 03 §9.1), and read-only withdraws every write from everyone but an admin (spec 06 §2).
 */
const PERMISSION_TABLE: Record<Regime, Record<Change, Record<Caller, Outcome>>> = {
  ownersAndAdmins: {
    destination: { owner: 200, admin: 200, bystander: 'forbidden' },
    keyword: { owner: 200, admin: 200, bystander: 'forbidden' },
    namespace: { owner: 200, admin: 200, bystander: 'forbidden' },
    unlisted: { owner: 200, admin: 200, bystander: 'forbidden' },
    owner: { owner: 'forbidden', admin: 200, bystander: 'forbidden' },
    delete: { owner: 204, admin: 204, bystander: 'forbidden' },
  },
  anyMember: {
    destination: { owner: 200, admin: 200, bystander: 200 },
    keyword: { owner: 200, admin: 200, bystander: 'forbidden' },
    namespace: { owner: 200, admin: 200, bystander: 'forbidden' },
    unlisted: { owner: 200, admin: 200, bystander: 'forbidden' },
    owner: { owner: 'forbidden', admin: 200, bystander: 'forbidden' },
    delete: { owner: 204, admin: 204, bystander: 'forbidden' },
  },
  readOnly: {
    destination: { owner: 'read_only', admin: 200, bystander: 'read_only' },
    keyword: { owner: 'read_only', admin: 200, bystander: 'read_only' },
    namespace: { owner: 'read_only', admin: 200, bystander: 'read_only' },
    unlisted: { owner: 'read_only', admin: 200, bystander: 'read_only' },
    owner: { owner: 'read_only', admin: 200, bystander: 'read_only' },
    delete: { owner: 'read_only', admin: 204, bystander: 'read_only' },
  },
}

const REGIMES: Regime[] = ['ownersAndAdmins', 'anyMember', 'readOnly']
const CHANGES: Change[] = ['destination', 'keyword', 'namespace', 'unlisted', 'owner', 'delete']
const CALLERS: Caller[] = ['owner', 'admin', 'bystander']

interface MatrixCase {
  regime: Regime
  change: Change
  caller: Caller
  expected: Outcome
}

const MATRIX: MatrixCase[] = REGIMES.flatMap((regime) =>
  CHANGES.flatMap((change) =>
    CALLERS.map((caller) => ({
      regime,
      change,
      caller,
      expected: PERMISSION_TABLE[regime][change][caller],
    })),
  ),
)

describe('the permission table of spec 03 §5', () => {
  it.each(MATRIX)(
    'answers $expected when the $caller changes the $change under $regime',
    async ({ regime, change, caller, expected }) => {
      await applySettings(app, WIDGETS, {
        namespaces: ['eng'],
        editMode: regime === 'anyMember' ? 'anyMember' : 'ownersAndAdmins',
        readOnly: regime === 'readOnly',
      })
      const link = await seed({ owner: ada })
      const who = { owner: ada, admin: grace, bystander: linus }[caller]

      const response =
        change === 'delete'
          ? await remove(who, link.id)
          : await patch(who, link.id, patchFor(change))

      if (typeof expected === 'number') {
        expect(response.statusCode).toBe(expected)
        return
      }
      expect(errorCodeOf(response)).toBe(expected)
      expect(response.statusCode).toBe(403)
    },
  )
})

/** The body that makes one kind of change. */
function patchFor(change: Exclude<Change, 'delete'>): Record<string, unknown> {
  switch (change) {
    case 'destination':
      return { destination: 'https://wiki.widgets.test/handbook/v2' }
    case 'keyword':
      return { keyword: 'runbook' }
    case 'namespace':
      return { namespace: 'eng' }
    case 'unlisted':
      return { isUnlisted: true }
    case 'owner':
      return { ownerId: String(linus.user.id) }
  }
}

describe('changing a link (spec 03 §7)', () => {
  it('moves the destination and records what changed', async () => {
    const link = await seed()

    const response = await patch(ada, link.id, { destination: 'wiki.widgets.test/v2' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ destination: 'https://wiki.widgets.test/v2' })
    const events = await readAuditEvents(database().db, WIDGETS, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.updated'])
    expect(events[0]?.data).toEqual({
      changes: {
        destination: ['https://wiki.widgets.test/handbook', 'https://wiki.widgets.test/v2'],
      },
    })
  })

  it('renames a link, keyword columns and all', async () => {
    const link = await seed()

    const response = await patch(ada, link.id, { keyword: 'Team/Handbook' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      keyword: 'team/handbook',
      displayKeyword: 'team/handbook',
      fullPath: 'go/team/handbook',
    })
    const [row] = await database().db.select().from(links).where(eq(links.id, link.id))
    expect(row).toMatchObject({ keywordPrefix: 'team', segmentCount: 2 })
  })

  it('changes several fields in one request', async () => {
    const link = await seed()

    const response = await patch(ada, link.id, {
      keyword: 'runbook',
      destination: 'https://runbooks.widgets.test/',
      isUnlisted: true,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      displayKeyword: 'runbook',
      destination: 'https://runbooks.widgets.test/',
      isUnlisted: true,
    })
  })

  it('leaves a rename to the same keyword alone rather than colliding with itself', async () => {
    const link = await seed()

    const response = await patch(ada, link.id, { keyword: 'handbook' })

    expect(response.statusCode).toBe(200)
  })

  it('answers keyword_exists with the link standing in the way of a rename', async () => {
    const link = await seed({ keyword: 'handbook' })
    await seed({ keyword: 'runbook' })

    const response = await patch(ada, link.id, { keyword: 'runbook' })

    expect(response.statusCode).toBe(409)
    const body = response.json<ErrorEnvelopeBody>()
    expect(body.error.code).toBe('keyword_exists')
    expect(body.error.existingLink).toMatchObject({ fullPath: 'go/runbook' })
  })

  it('answers keyword_conflict when a rename would collide with a pattern', async () => {
    const link = await seed({ keyword: 'handbook' })
    await seed({ keyword: 'jira/%s' })

    const response = await patch(ada, link.id, { keyword: 'jira/abc' })

    expect(response.statusCode).toBe(409)
    expect(errorCodeOf(response)).toBe('keyword_conflict')
  })

  it.each([
    ['keyword_invalid', { keyword: 'Not Allowed!' }],
    ['keyword_reserved', { keyword: '_internal' }],
    ['namespace_invalid', { namespace: 'nowhere' }],
    ['destination_invalid', { destination: 'javascript:alert(1)' }],
    ['placeholder_count_mismatch', { keyword: 'jira/%s' }],
  ])('re-runs validation and answers %s', async (code, payload) => {
    const link = await seed()

    const response = await patch(ada, link.id, payload)

    expect(errorCodeOf(response)).toBe(code)
    expect(response.statusCode).toBe(400)
  })

  it('rejects a body that changes nothing', async () => {
    const link = await seed()

    const response = await patch(ada, link.id, {})

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })

  it('rejects a field it does not accept', async () => {
    const link = await seed()

    const response = await patch(ada, link.id, { visitCount: 99 })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
  })

  it('answers 404 when the link belongs to another organization', async () => {
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await insertUser(db, { email: `zoe@${GIZMOS}`, organizationId: GIZMOS })
    const theirs = await seed({ organizationId: GIZMOS, ownerId: stranger.id })

    const response = await patch(grace, theirs.id, { destination: 'https://elsewhere.test/' })

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('not_found')
  })
})

describe('assigning an owner directly (spec 03 §9.1)', () => {
  it('lets an admin hand the link to another member and records the transfer', async () => {
    const link = await seed({ owner: ada })

    const response = await patch(grace, link.id, { ownerId: String(linus.user.id) })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ owner: { id: String(linus.user.id) } })
    const events = await readAuditEvents(database().db, WIDGETS, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.transferred'])
    expect(events[0]?.data).toEqual({
      fromUserId: String(ada.user.id),
      toUserId: String(linus.user.id),
      method: 'direct',
    })
  })

  it('answers owner_invalid when the named member is not one of ours', async () => {
    const link = await seed()

    const response = await patch(grace, link.id, { ownerId: '999999' })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('owner_invalid')
  })

  it('answers owner_invalid when the named member has been disabled', async () => {
    const { db } = database()
    const link = await seed()
    await db.update(users).set({ isEnabled: false }).where(eq(users.id, linus.user.id))

    const response = await patch(grace, link.id, { ownerId: String(linus.user.id) })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('owner_invalid')
  })

  it('accepts an owner who is already the owner as a change to nothing', async () => {
    const link = await seed({ owner: ada })

    const response = await patch(ada, link.id, { ownerId: String(ada.user.id) })

    expect(response.statusCode).toBe(200)
    expect(await readAuditEvents(database().db, WIDGETS, { type: 'link', id: link.id })).toEqual([])
  })
})

describe('deleting a link (spec 03 §8)', () => {
  it('answers 204, removes the row, and keeps a snapshot in the trail', async () => {
    const link = await seed()

    const response = await remove(ada, link.id)

    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    const rows = await database().db.select().from(links).where(eq(links.id, link.id))
    expect(rows).toEqual([])
    const events = await readAuditEvents(database().db, WIDGETS, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.deleted'])
    expect(events[0]?.data).toMatchObject({ fullPath: 'go/handbook' })
  })

  it('answers 404 the second time', async () => {
    const link = await seed()
    await remove(ada, link.id)

    const response = await remove(ada, link.id)

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('not_found')
  })

  it('answers 404 for a link in another organization', async () => {
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await insertUser(db, { email: `zoe@${GIZMOS}`, organizationId: GIZMOS })
    const theirs = await seed({ organizationId: GIZMOS, ownerId: stranger.id })

    const response = await remove(grace, theirs.id)

    expect(response.statusCode).toBe(404)
    const rows = await database().db.select().from(links).where(eq(links.id, theirs.id))
    expect(rows).toHaveLength(1)
  })
})

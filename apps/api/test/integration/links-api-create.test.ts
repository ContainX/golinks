// `POST /_/api/v1/links` (spec 05 §3, spec 03 §6).
//
// The validation order of spec 03 §6 has a code for every step, and this suite reaches each of
// them through HTTP rather than through the service, so the endpoint is proven to hand the
// right refusal to a client rather than only to a caller.

import { API_BASE_PATH, LinkSchema } from '@golinks/shared/api'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { links } from '../../src/db/schema/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  applySettings,
  buildLinksApp,
  type ErrorEnvelopeBody,
  errorCodeOf,
  type SignedInMember,
  signInMember,
} from './links-fixtures.ts'

const database = useTestDatabase()
const LINKS_URL = `${API_BASE_PATH}/links`
const WIDGETS = TEST_ORGANIZATION_IDS.widgets
const HANDBOOK = 'https://wiki.widgets.test/handbook'

let app: GoLinksApp
let owner: SignedInMember
let admin: SignedInMember

beforeEach(async () => {
  await resetDatabase()
  app = await buildLinksApp(database().db)
  owner = await signInMember(app, database().db, { email: `ada@${WIDGETS}` })
  admin = await signInMember(app, database().db, { email: `grace@${WIDGETS}`, admin: true })
})

afterEach(async () => {
  await app.close()
})

interface CreateBody {
  keyword?: unknown
  destination?: unknown
  namespace?: unknown
  isUnlisted?: unknown
  ownerId?: unknown
  [key: string]: unknown
}

function post(who: SignedInMember, payload: CreateBody) {
  return app.inject({ method: 'POST', url: LINKS_URL, headers: who.apiHeaders, payload })
}

describe('creating a link', () => {
  it('answers 201 with the link resource the shared schema describes', async () => {
    const response = await post(owner, { keyword: 'Handbook/', destination: 'wiki.widgets.test/x' })

    expect(response.statusCode).toBe(201)
    const parsed = LinkSchema.safeParse(response.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.data).toMatchObject({
      namespace: 'go',
      keyword: 'handbook',
      displayKeyword: 'handbook',
      fullPath: 'go/handbook',
      // Spec 03 §3: the stored destination is what was typed, with the scheme filled in.
      destination: 'https://wiki.widgets.test/x',
      isProgrammatic: false,
      placeholderCount: 0,
      isUnlisted: false,
      visitCount: 0,
      lastVisitedAt: null,
      owner: { id: String(owner.user.id), email: owner.user.email },
      permissions: { canEditDestination: true, canEdit: true, canDelete: true, canTransfer: true },
    })
  })

  it('stores the row against the caller as owner and creator', async () => {
    const response = await post(owner, { keyword: 'handbook', destination: HANDBOOK })
    const id = Number(response.json<{ id: string }>().id)

    const [row] = await database().db.select().from(links).where(eq(links.id, id))
    expect(row).toMatchObject({
      organizationId: WIDGETS,
      ownerId: owner.user.id,
      createdById: owner.user.id,
      keywordPrefix: 'handbook',
      segmentCount: 1,
    })
  })

  it('records a programmatic link with its placeholder count', async () => {
    const response = await post(owner, {
      keyword: 'jira/%s',
      destination: 'https://jira.widgets.test/browse/%s',
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ isProgrammatic: true, placeholderCount: 1 })
  })

  it('lets an admin create a link on behalf of another member', async () => {
    const response = await post(admin, {
      keyword: 'payroll',
      destination: HANDBOOK,
      ownerId: String(owner.user.id),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ owner: { id: String(owner.user.id) } })
  })

  it('refuses an unauthenticated caller with 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: LINKS_URL,
      headers: { origin: app.appConfig.baseUrl, 'content-type': 'application/json' },
      payload: { keyword: 'handbook', destination: HANDBOOK },
    })

    expect(response.statusCode).toBe(401)
    expect(errorCodeOf(response)).toBe('unauthenticated')
  })
})

describe('the refusals of spec 03 §6', () => {
  it.each([
    ['a missing keyword', { destination: HANDBOOK }],
    ['a missing destination', { keyword: 'handbook' }],
    ['an unknown field', { keyword: 'handbook', destination: HANDBOOK, colour: 'red' }],
    ['a keyword of the wrong type', { keyword: 7, destination: HANDBOOK }],
  ])('answers validation_failed for %s', async (_case, payload: CreateBody) => {
    const response = await post(owner, payload)

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('validation_failed')
    expect(response.json<ErrorEnvelopeBody>().error.details).toHaveProperty('fields')
  })

  it.each([
    ['keyword_invalid', { keyword: 'a//b', destination: HANDBOOK }],
    ['keyword_invalid', { keyword: 'Not Allowed!', destination: HANDBOOK }],
    ['keyword_reserved', { keyword: '_internal', destination: HANDBOOK }],
    ['namespace_invalid', { keyword: 'handbook', destination: HANDBOOK, namespace: 'nowhere' }],
    ['placeholder_invalid', { keyword: '%s/issues', destination: 'https://gh.test/%s/issues' }],
    ['placeholder_invalid', { keyword: 'gh/%s/issues', destination: 'https://gh.test/%s/issues' }],
    ['placeholder_count_mismatch', { keyword: 'jira/%s', destination: HANDBOOK }],
    ['destination_invalid', { keyword: 'handbook', destination: 'javascript:alert(1)' }],
    ['destination_invalid', { keyword: 'handbook', destination: 'ftp://files.test/x' }],
  ])('answers %s', async (code, payload: CreateBody) => {
    const response = await post(owner, payload)

    expect(errorCodeOf(response)).toBe(code)
    expect(response.statusCode).toBe(400)
  })

  it('answers namespace_reserved when a keyword shadows a namespace', async () => {
    await applySettings(app, WIDGETS, { namespaces: ['eng'] })

    const response = await post(owner, { keyword: 'eng/deploy', destination: HANDBOOK })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('namespace_reserved')
  })

  it('answers owner_invalid when an admin names someone who is not a member here', async () => {
    const response = await post(admin, {
      keyword: 'handbook',
      destination: HANDBOOK,
      ownerId: '999999',
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('owner_invalid')
  })

  it('answers owner_invalid for a member of another organization', async () => {
    const stranger = await signInMember(app, database().db, {
      email: `zoe@${TEST_ORGANIZATION_IDS.gizmos}`,
    })

    const response = await post(admin, {
      keyword: 'handbook',
      destination: HANDBOOK,
      ownerId: String(stranger.user.id),
    })

    expect(response.statusCode).toBe(400)
    expect(errorCodeOf(response)).toBe('owner_invalid')
  })

  it('answers forbidden when a member names anyone but themselves as owner', async () => {
    const response = await post(owner, {
      keyword: 'handbook',
      destination: HANDBOOK,
      ownerId: String(admin.user.id),
    })

    expect(response.statusCode).toBe(403)
    expect(errorCodeOf(response)).toBe('forbidden')
  })

  it('answers read_only to a member while the organization is read-only', async () => {
    await applySettings(app, WIDGETS, { readOnly: true })

    const response = await post(owner, { keyword: 'handbook', destination: HANDBOOK })

    expect(response.statusCode).toBe(403)
    expect(errorCodeOf(response)).toBe('read_only')
  })

  it('still lets an admin create while the organization is read-only', async () => {
    await applySettings(app, WIDGETS, { readOnly: true })

    const response = await post(admin, { keyword: 'handbook', destination: HANDBOOK })

    expect(response.statusCode).toBe(201)
  })

  it('answers keyword_exists with the link that stands in the way', async () => {
    await post(owner, { keyword: 'handbook', destination: HANDBOOK })

    const response = await post(admin, { keyword: 'handbook', destination: 'https://other.test/' })

    expect(response.statusCode).toBe(409)
    const body = response.json<ErrorEnvelopeBody>()
    expect(body.error.code).toBe('keyword_exists')
    expect(body.error.existingLink).toMatchObject({ fullPath: 'go/handbook' })
    // The admin reading the error sees their own permissions on the link in the way.
    expect(body.error.existingLink?.permissions.canEdit).toBe(true)
  })

  it('answers keyword_conflict when a pattern already covers the keyword', async () => {
    await post(owner, { keyword: 'jira/%s', destination: 'https://jira.test/%s' })

    const response = await post(owner, { keyword: 'jira/abc', destination: HANDBOOK })

    expect(response.statusCode).toBe(409)
    const body = response.json<ErrorEnvelopeBody>()
    expect(body.error.code).toBe('keyword_conflict')
    expect(body.error.existingLink).toMatchObject({ fullPath: 'go/jira/%s' })
  })
})

describe('the creation rate limit (spec 05 §5)', () => {
  it('answers rate_limited once the budget for the window is spent', async () => {
    await app.close()
    app = await buildLinksApp(database().db, { RATE_LIMIT_LINK_CREATE: '2' })
    owner = await signInMember(app, database().db, { email: `ada@${WIDGETS}` })

    const first = await post(owner, { keyword: 'one', destination: HANDBOOK })
    const second = await post(owner, { keyword: 'two', destination: HANDBOOK })
    const third = await post(owner, { keyword: 'three', destination: HANDBOOK })

    expect([first.statusCode, second.statusCode]).toEqual([201, 201])
    expect(third.statusCode).toBe(429)
    expect(errorCodeOf(third)).toBe('rate_limited')
    expect(third.headers['retry-after']).toBeDefined()
  })

  it('counts the budget per session, not for the whole deployment', async () => {
    await app.close()
    app = await buildLinksApp(database().db, { RATE_LIMIT_LINK_CREATE: '1' })
    owner = await signInMember(app, database().db, { email: `ada@${WIDGETS}` })
    const colleague = await signInMember(app, database().db, { email: `linus@${WIDGETS}` })

    await post(owner, { keyword: 'one', destination: HANDBOOK })
    const spent = await post(owner, { keyword: 'two', destination: HANDBOOK })
    const fresh = await post(colleague, { keyword: 'three', destination: HANDBOOK })

    expect(spent.statusCode).toBe(429)
    expect(fresh.statusCode).toBe(201)
  })
})

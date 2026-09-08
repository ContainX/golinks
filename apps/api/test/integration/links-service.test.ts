// Creating, renaming, and deleting links end to end (spec 03 §6, §7, §8).

import type { OrganizationSettings } from '@golinks/shared/settings'
import { count, eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { type LinkRow, links } from '../../src/db/schema/index.ts'
import { type ApiError, isApiError } from '../../src/errors.ts'
import {
  createLinkWithChecks,
  deleteLinkWithChecks,
  findById,
  renameLinkWithChecks,
} from '../../src/links/index.ts'
import type { CurrentMember } from '../../src/types.ts'
import { TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  type LinkWorld,
  readAuditEvents,
  seedLinkWorld,
  settingsWithKeywordRules,
  testSettings,
  writeContext,
} from './links-fixtures.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets
const HANDBOOK = 'https://wiki.widgets.test/handbook'

let world: LinkWorld

beforeEach(async () => {
  await resetDatabase()
  world = await seedLinkWorld(database().db)
})

interface CreateOptions {
  keyword: string
  destination?: string
  namespace?: string
  isUnlisted?: boolean
  ownerId?: number
  member?: CurrentMember
  settings?: OrganizationSettings
}

function create({
  member = world.ownerMember,
  settings = testSettings(),
  destination = HANDBOOK,
  ...rest
}: CreateOptions): Promise<LinkRow> {
  return createLinkWithChecks(database().db, {
    ...writeContext(member, settings),
    destination,
    ...rest,
  })
}

/** The `ApiError` a call threw, so a test can read its code and its `existingLink`. */
async function failure(work: Promise<unknown>): Promise<ApiError> {
  const thrown = await work.then(
    () => undefined,
    (error: unknown) => error,
  )
  if (!isApiError(thrown)) throw new Error(`Expected an ApiError, got ${String(thrown)}`)
  return thrown
}

async function countLinks(): Promise<number> {
  const [row] = await database()
    .db.select({ value: count() })
    .from(links)
    .where(eq(links.organizationId, ORG))
  return row?.value ?? 0
}

describe('creating a link', () => {
  it('stores the link and records link.created', async () => {
    const link = await create({ keyword: 'Handbook/', destination: 'wiki.widgets.test/handbook' })

    expect(link).toMatchObject({
      organizationId: ORG,
      namespace: 'go',
      keyword: 'handbook',
      displayKeyword: 'handbook',
      keywordPrefix: 'handbook',
      segmentCount: 1,
      placeholderCount: 0,
      // The stored destination is what the owner typed, with the default scheme added.
      destination: 'https://wiki.widgets.test/handbook',
      ownerId: world.owner.id,
      createdById: world.owner.id,
      isUnlisted: false,
    })

    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.created'])
    expect(events[0]).toMatchObject({ actorUserId: world.owner.id, requestId: 'req-test' })
    expect(events[0]?.data).toMatchObject({
      id: String(link.id),
      fullPath: 'go/handbook',
      destination: 'https://wiki.widgets.test/handbook',
    })
  })

  it('keeps the display keyword the member typed beside the canonical one', async () => {
    const settings = settingsWithKeywordRules({ punctuationSensitive: false })
    const link = await create({ keyword: 'meeting-notes', settings })
    expect(link).toMatchObject({ keyword: 'meetingnotes', displayKeyword: 'meeting-notes' })
  })

  it('stores a programmatic keyword with its placeholder count', async () => {
    const link = await create({
      keyword: 'gh/%s/%s',
      destination: 'https://github.test/widgets/%s/issues/%s',
    })
    expect(link).toMatchObject({ placeholderCount: 2, segmentCount: 3, keywordPrefix: 'gh' })
  })

  it('defaults the namespace and accepts a configured one', async () => {
    const settings = testSettings({ namespaces: ['eng'] })
    await expect(create({ keyword: 'handbook', settings })).resolves.toMatchObject({
      namespace: 'go',
    })
    await expect(create({ keyword: 'deploy', namespace: 'ENG ', settings })).resolves.toMatchObject(
      { namespace: 'eng' },
    )
  })

  it.each([
    ['namespace_invalid', { keyword: 'handbook', namespace: 'nope' }],
    ['keyword_reserved', { keyword: '_internal' }],
    ['keyword_invalid', { keyword: 'Not Allowed!' }],
    ['placeholder_invalid', { keyword: 'gh/%s/issues' }],
    ['destination_invalid', { keyword: 'handbook', destination: 'javascript:alert(1)' }],
    [
      'placeholder_count_mismatch',
      { keyword: 'jira/%s', destination: 'https://jira.widgets.test/browse' },
    ],
  ] as const)('refuses the request with %s', async (code, options) => {
    const error = await failure(create(options))
    expect(error.code).toBe(code)
    await expect(countLinks()).resolves.toBe(0)
  })

  it('refuses a first segment that names one of the namespaces', async () => {
    const settings = testSettings({ namespaces: ['eng'] })
    const error = await failure(create({ keyword: 'eng/deploy', settings }))
    expect(error.code).toBe('namespace_reserved')
  })

  it('allows a single-segment keyword named after a namespace', async () => {
    const settings = testSettings({ namespaces: ['eng'] })
    await expect(create({ keyword: 'eng', settings })).resolves.toMatchObject({ keyword: 'eng' })
  })

  it('holds members back in a read-only organization but not admins', async () => {
    const settings = testSettings({ readOnly: true })
    const error = await failure(create({ keyword: 'handbook', settings }))
    expect(error.code).toBe('read_only')
    expect(error.status).toBe(403)

    await expect(
      create({ keyword: 'handbook', settings, member: world.adminMember }),
    ).resolves.toMatchObject({ keyword: 'handbook' })
  })

  it('lets an admin name another owner, and refuses a member the same', async () => {
    const link = await create({
      keyword: 'handbook',
      member: world.adminMember,
      ownerId: world.bystander.id,
    })
    expect(link.ownerId).toBe(world.bystander.id)
    expect(link.createdById).toBe(world.admin.id)

    const error = await failure(
      create({ keyword: 'runbook', member: world.ownerMember, ownerId: world.bystander.id }),
    )
    expect(error.code).toBe('forbidden')
  })

  it('refuses an owner who is not an enabled member of the organization', async () => {
    const error = await failure(
      create({ keyword: 'handbook', member: world.adminMember, ownerId: 999_999 }),
    )
    expect(error.code).toBe('owner_invalid')
  })

  it('reports keyword_exists with the link in the way as existingLink', async () => {
    const existing = await create({ keyword: 'handbook' })

    const error = await failure(create({ keyword: 'handbook', member: world.bystanderMember }))
    expect(error.code).toBe('keyword_exists')
    expect(error.status).toBe(409)
    expect(error.existingLink).toMatchObject({
      id: String(existing.id),
      fullPath: 'go/handbook',
      owner: { id: String(world.owner.id), email: world.owner.email },
      // Permissions are the asking member's, not the owner's (spec 03 §5).
      permissions: { canEdit: false, canDelete: false },
    })
  })

  it('reports keyword_conflict with the pattern in the way', async () => {
    const pattern = await create({
      keyword: 'jira/%s',
      destination: 'https://jira.widgets.test/browse/%s',
    })

    const error = await failure(create({ keyword: 'jira/abc' }))
    expect(error.code).toBe('keyword_conflict')
    expect(error.details).toMatchObject({ reason: 'pattern_match' })
    expect(error.existingLink).toMatchObject({ id: String(pattern.id) })
  })

  it('lets an admin see their own permissions on the conflicting link', async () => {
    await create({ keyword: 'handbook' })
    const error = await failure(create({ keyword: 'handbook', member: world.adminMember }))
    expect(error.existingLink).toMatchObject({
      permissions: { canEdit: true, canDelete: true, canTransfer: true },
    })
  })

  it('creates the same keyword in two namespaces without a conflict', async () => {
    const settings = testSettings({ namespaces: ['eng'] })
    await create({ keyword: 'deploy', settings })
    await expect(create({ keyword: 'deploy', namespace: 'eng', settings })).resolves.toMatchObject({
      namespace: 'eng',
    })
    await expect(countLinks()).resolves.toBe(2)
  })
})

describe('two members creating the same keyword at once', () => {
  it('yields exactly one link and exactly one keyword_exists', async () => {
    const results = await Promise.allSettled([
      create({ keyword: 'handbook', member: world.ownerMember }),
      create({ keyword: 'handbook', member: world.bystanderMember }),
    ])

    const created = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')
    expect(created).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const reason: unknown = rejected[0]?.status === 'rejected' ? rejected[0].reason : undefined
    expect(isApiError(reason) && reason.code).toBe('keyword_exists')

    await expect(countLinks()).resolves.toBe(1)
    const events = await readAuditEvents(database().db, ORG)
    expect(events.map((event) => event.type)).toEqual(['link.created'])
  })

  it('lets two different prefixes through side by side', async () => {
    const results = await Promise.all([
      create({ keyword: 'handbook' }),
      create({ keyword: 'runbook' }),
    ])
    expect(results.map((link) => link.keyword).sort()).toEqual(['handbook', 'runbook'])
  })
})

describe('renaming a link', () => {
  it('moves the keyword and records what changed', async () => {
    const link = await create({ keyword: 'handbook' })

    const renamed = await renameLinkWithChecks(database().db, {
      ...writeContext(world.ownerMember),
      link,
      keyword: 'hand-book-2',
    })

    expect(renamed).toMatchObject({
      keyword: 'hand-book-2',
      displayKeyword: 'hand-book-2',
      keywordPrefix: 'hand-book-2',
    })
    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.created', 'link.updated'])
    expect(events[1]?.data).toEqual({
      changes: {
        keyword: ['handbook', 'hand-book-2'],
        displayKeyword: ['handbook', 'hand-book-2'],
      },
    })
  })

  it('does not let a link conflict with itself', async () => {
    const settings = settingsWithKeywordRules({ punctuationSensitive: false })
    const link = await create({ keyword: 'handbook', settings })

    // The canonical keyword does not move; only what the directory shows does.
    const renamed = await renameLinkWithChecks(database().db, {
      ...writeContext(world.ownerMember, settings),
      link,
      keyword: 'hand-book',
    })

    expect(renamed).toMatchObject({ keyword: 'handbook', displayKeyword: 'hand-book' })
    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events[1]?.data).toEqual({ changes: { displayKeyword: ['handbook', 'hand-book'] } })
  })

  it('refuses a rename onto an existing keyword', async () => {
    await create({ keyword: 'handbook' })
    const other = await create({ keyword: 'runbook' })

    const error = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember),
        link: other,
        keyword: 'handbook',
      }),
    )
    expect(error.code).toBe('keyword_exists')
    expect(error.existingLink).toMatchObject({ fullPath: 'go/handbook' })
  })

  it('refuses a rename that a pattern would swallow', async () => {
    await create({ keyword: 'jira/%s', destination: 'https://jira.widgets.test/browse/%s' })
    const plain = await create({ keyword: 'handbook' })

    const error = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember),
        link: plain,
        keyword: 'jira/abc',
      }),
    )
    expect(error.code).toBe('keyword_conflict')
  })

  it('moves a link to another namespace', async () => {
    const settings = testSettings({ namespaces: ['eng'] })
    const link = await create({ keyword: 'deploy', settings })

    const moved = await renameLinkWithChecks(database().db, {
      ...writeContext(world.ownerMember, settings),
      link,
      namespace: 'eng',
    })

    expect(moved.namespace).toBe('eng')
    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events[1]?.data).toEqual({ changes: { namespace: ['go', 'eng'] } })
  })

  it('refuses a move into a namespace the organization does not have', async () => {
    const link = await create({ keyword: 'handbook' })

    const error = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember),
        link,
        namespace: 'nope',
      }),
    )
    expect(error.code).toBe('namespace_invalid')
  })

  it('re-runs the reserved-prefix rule when the namespace changes', async () => {
    const settings = testSettings({ namespaces: ['eng'] })
    const link = await create({ keyword: 'eng/deploy', namespace: 'eng', settings })

    const error = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember, settings),
        link,
        namespace: 'go',
      }),
    )
    expect(error.code).toBe('namespace_reserved')
  })

  it('leaves an unchanged keyword unvalidated when the pattern has since tightened', async () => {
    const link = await create({ keyword: 'meeting-notes' })
    // The organization narrows its pattern; the existing keyword no longer matches it.
    const settings = settingsWithKeywordRules({ allowedPattern: '^[a-z]+$' })

    const updated = await renameLinkWithChecks(database().db, {
      ...writeContext(world.ownerMember, settings),
      link,
      destination: 'https://wiki.widgets.test/notes',
    })

    expect(updated.destination).toBe('https://wiki.widgets.test/notes')

    const error = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember, settings),
        link: updated,
        keyword: 'meeting-notes-2',
      }),
    )
    expect(error.code).toBe('keyword_invalid')
  })

  it('checks the placeholder counts against whichever half is not changing', async () => {
    const link = await create({
      keyword: 'jira/%s',
      destination: 'https://jira.widgets.test/browse/%s',
    })

    const droppedPlaceholder = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember),
        link,
        destination: 'https://jira.widgets.test/browse',
      }),
    )
    expect(droppedPlaceholder.code).toBe('placeholder_count_mismatch')

    const droppedSegment = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember),
        link,
        keyword: 'jira',
      }),
    )
    expect(droppedSegment.code).toBe('placeholder_count_mismatch')
  })

  it('hands the link to another member when an admin sets the owner', async () => {
    const link = await create({ keyword: 'handbook' })

    const transferred = await renameLinkWithChecks(database().db, {
      ...writeContext(world.adminMember),
      link,
      ownerId: world.bystander.id,
    })

    expect(transferred.ownerId).toBe(world.bystander.id)
    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.created', 'link.transferred'])
  })

  it('refuses another member the keyword, and the destination unless editMode opens it', async () => {
    const link = await create({ keyword: 'handbook' })

    const rename = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.bystanderMember),
        link,
        keyword: 'runbook',
      }),
    )
    expect(rename.code).toBe('forbidden')

    const destination = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.bystanderMember),
        link,
        destination: 'https://elsewhere.test/',
      }),
    )
    expect(destination.code).toBe('forbidden')

    const opened = await renameLinkWithChecks(database().db, {
      ...writeContext(world.bystanderMember, testSettings({ editMode: 'anyMember' })),
      link,
      destination: 'https://elsewhere.test/',
    })
    expect(opened.destination).toBe('https://elsewhere.test/')
  })

  it('reports read_only before anything else in a read-only organization', async () => {
    const link = await create({ keyword: 'handbook' })
    const error = await failure(
      renameLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember, testSettings({ readOnly: true })),
        link,
        keyword: 'runbook',
      }),
    )
    expect(error.code).toBe('read_only')
  })

  it('writes nothing when the request changes nothing', async () => {
    const link = await create({ keyword: 'handbook' })
    const same = await renameLinkWithChecks(database().db, {
      ...writeContext(world.ownerMember),
      link,
      keyword: 'handbook',
    })

    expect(same.updatedAt).toEqual(link.updatedAt)
    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.created'])
  })
})

describe('deleting a link', () => {
  it('removes the link and records the snapshot', async () => {
    const link = await create({ keyword: 'handbook' })

    await deleteLinkWithChecks(database().db, { ...writeContext(world.ownerMember), link })

    await expect(findById(database().db, ORG, link.id)).resolves.toBeUndefined()
    const events = await readAuditEvents(database().db, ORG, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.created', 'link.deleted'])
  })

  it('refuses another member, and reports read_only rather than forbidden when the organization is', async () => {
    const link = await create({ keyword: 'handbook' })

    const forbidden = await failure(
      deleteLinkWithChecks(database().db, { ...writeContext(world.bystanderMember), link }),
    )
    expect(forbidden.code).toBe('forbidden')

    const readOnly = await failure(
      deleteLinkWithChecks(database().db, {
        ...writeContext(world.ownerMember, testSettings({ readOnly: true })),
        link,
      }),
    )
    expect(readOnly.code).toBe('read_only')

    await expect(findById(database().db, ORG, link.id)).resolves.toMatchObject({ id: link.id })
  })
})

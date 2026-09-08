// Keyword conflict detection against a real Postgres (spec 03 §6.1).
//
// Every case of the section, in both directions where the section names one, in the
// standard and prefixFallback resolution modes and in a punctuation-insensitive
// organization.

import type { OrganizationSettings } from '@golinks/shared/settings'
import { beforeEach, describe, expect, it } from 'vitest'
import type { LinkRow } from '../../src/db/schema/index.ts'
import { detectKeywordConflict, type KeywordConflictResult } from '../../src/links/index.ts'
import { insertLink, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  evaluateFor,
  type LinkWorld,
  seedLinkWorld,
  settingsWithKeywordRules,
  testSettings,
} from './links-fixtures.ts'

const database = useTestDatabase()
const ORG = TEST_ORGANIZATION_IDS.widgets
const OTHER_ORG = TEST_ORGANIZATION_IDS.gizmos

let world: LinkWorld

beforeEach(async () => {
  await resetDatabase()
  world = await seedLinkWorld(database().db)
})

/** Seeds an already canonical keyword, the way a previous write would have left it. */
async function seed(
  keyword: string,
  options: { namespace?: string; displayKeyword?: string; organizationId?: string } = {},
): Promise<LinkRow> {
  const world_ = world
  return await insertLink(database().db, {
    organizationId: options.organizationId ?? ORG,
    ownerId: world_.owner.id,
    keyword,
    ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
    ...(options.displayKeyword === undefined ? {} : { displayKeyword: options.displayKeyword }),
  })
}

function detect(
  keyword: string,
  settings: OrganizationSettings = testSettings(),
  options: { namespace?: string; excludeLinkId?: number } = {},
): Promise<KeywordConflictResult> {
  const namespace = options.namespace ?? settings.defaultNamespace
  return detectKeywordConflict(database().db, {
    organizationId: ORG,
    namespace,
    evaluation: evaluateFor(keyword, settings, namespace),
    rules: settings.keywords,
    ...(options.excludeLinkId === undefined ? {} : { excludeLinkId: options.excludeLinkId }),
  })
}

describe('case 1: the same canonical keyword already exists', () => {
  it('reports keyword_exists and hands back the link in the way', async () => {
    const existing = await seed('handbook')

    const result = await detect('handbook')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('keyword_exists')
    expect(result.reason).toBe('exact')
    expect(result.existing.id).toBe(existing.id)
    expect(result.message).toContain('go/handbook')
  })

  it('lets a link keep its own keyword when it is the one being renamed', async () => {
    const existing = await seed('handbook')
    await expect(
      detect('handbook', testSettings(), { excludeLinkId: existing.id }),
    ).resolves.toEqual({ ok: true })
  })

  it('sees nothing in another namespace of the same organization', async () => {
    await seed('deploy', { namespace: 'eng' })
    const settings = testSettings({ namespaces: ['eng'] })
    await expect(detect('deploy', settings)).resolves.toEqual({ ok: true })
  })

  it('sees nothing in another organization', async () => {
    const elsewhere = await seedLinkWorld(database().db, OTHER_ORG)
    await insertLink(database().db, {
      organizationId: OTHER_ORG,
      ownerId: elsewhere.owner.id,
      keyword: 'handbook',
    })

    await expect(detect('handbook')).resolves.toEqual({ ok: true })
  })
})

describe('case 2: the new keyword would pattern-match a programmatic link', () => {
  it('refuses jira/abc while jira/%s exists', async () => {
    const existing = await seed('jira/%s')

    const result = await detect('jira/abc')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('keyword_conflict')
    expect(result.reason).toBe('pattern_match')
    expect(result.existing.id).toBe(existing.id)
  })

  it('refuses docs/api/v2 while docs/api/%s exists', async () => {
    await seed('docs/api/%s')
    const result = await detect('docs/api/v2')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('pattern_match')
  })

  it('refuses gh/repo/%s while gh/%s/%s exists, the wider pattern winning', async () => {
    const wide = await seed('gh/%s/%s')
    const result = await detect('gh/repo/%s')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('pattern_match')
    expect(result.existing.id).toBe(wide.id)
  })

  it('allows a keyword whose segment count no pattern shares', async () => {
    await seed('gh/%s/%s')
    await expect(detect('gh/web')).resolves.toEqual({ ok: true })
  })

  it('allows a single-segment keyword while a pattern shares its first segment', async () => {
    await seed('jira/%s')
    await expect(detect('jira')).resolves.toEqual({ ok: true })
  })

  it('does not read a plain keyword as a pattern', async () => {
    await seed('gh/web')
    await expect(detect('gh/api')).resolves.toEqual({ ok: true })
  })
})

describe('case 3: a new programmatic keyword stands in for an existing one', () => {
  it('refuses jira/%s while jira/abc exists', async () => {
    const existing = await seed('jira/abc')

    const result = await detect('jira/%s')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('keyword_conflict')
    expect(result.reason).toBe('programmatic_overlap')
    expect(result.existing.id).toBe(existing.id)
  })

  it('refuses gh/%s/%s while gh/repo/%s exists, the opposite direction of case 2', async () => {
    const narrow = await seed('gh/repo/%s')
    const result = await detect('gh/%s/%s')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('programmatic_overlap')
    expect(result.existing.id).toBe(narrow.id)
  })

  it('refuses docs/api/%s while docs/api/v2 exists', async () => {
    await seed('docs/api/v2')
    const result = await detect('docs/api/%s')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('programmatic_overlap')
  })

  it('allows a pattern of a different length', async () => {
    await seed('gh/%s/%s')
    await expect(detect('gh/%s')).resolves.toEqual({ ok: true })
  })

  it('lets a programmatic link keep its keyword when it is the one being renamed', async () => {
    const existing = await seed('jira/%s')
    await expect(
      detect('jira/%s', testSettings(), { excludeLinkId: existing.id }),
    ).resolves.toEqual({ ok: true })
  })
})

describe('case 4: prefix fallback', () => {
  const prefixFallback = settingsWithKeywordRules({ resolutionMode: 'prefixFallback' })

  it('refuses example while example/%s exists', async () => {
    const pattern = await seed('example/%s')

    const result = await detect('example', prefixFallback)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('keyword_conflict')
    expect(result.reason).toBe('prefix_fallback')
    expect(result.existing.id).toBe(pattern.id)
  })

  it('refuses example/%s while example exists, the other direction', async () => {
    const plain = await seed('example')

    const result = await detect('example/%s', prefixFallback)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('prefix_fallback')
    expect(result.existing.id).toBe(plain.id)
  })

  it('leaves the same pair alone in standard mode', async () => {
    await seed('example/%s')
    await expect(detect('example', testSettings())).resolves.toEqual({ ok: true })

    await seed('other')
    await expect(detect('other/%s', testSettings())).resolves.toEqual({ ok: true })
  })

  it('still applies the exact and pattern cases in prefix fallback mode', async () => {
    await seed('handbook')
    const exact = await detect('handbook', prefixFallback)
    expect(exact.ok).toBe(false)
    if (exact.ok) return
    expect(exact.code).toBe('keyword_exists')
  })

  it('leaves unrelated prefixes alone', async () => {
    await seed('example/%s')
    await expect(detect('elsewhere', prefixFallback)).resolves.toEqual({ ok: true })
  })
})

describe('punctuation-insensitive organizations', () => {
  const insensitive = settingsWithKeywordRules({ punctuationSensitive: false })

  it('reports keyword_exists for a keyword that only differs in punctuation', async () => {
    const existing = await seed('meetingnotes', { displayKeyword: 'meeting-notes' })

    const result = await detect('meeting-notes', insensitive)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('keyword_exists')
    expect(result.existing.id).toBe(existing.id)
    // The message names the link as the directory shows it.
    expect(result.message).toContain('go/meeting-notes')
  })

  it('matches a pattern through the canonical first segment', async () => {
    const pattern = await seed('jirax/%s', { displayKeyword: 'jira-x/%s' })

    const result = await detect('jira-x/abc', insensitive)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('pattern_match')
    expect(result.existing.id).toBe(pattern.id)
  })

  it('refuses a pattern that would stand in for a punctuated keyword', async () => {
    const existing = await seed('jira/abc', { displayKeyword: 'jira/a-b-c' })

    const result = await detect('jira/%s', insensitive)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('programmatic_overlap')
    expect(result.existing.id).toBe(existing.id)
  })

  it('keeps the same two keywords apart while punctuation is significant', async () => {
    await seed('meetingnotes', { displayKeyword: 'meetingnotes' })
    await expect(detect('meeting-notes', testSettings())).resolves.toEqual({ ok: true })
  })
})

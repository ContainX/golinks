import type { KeywordRules } from '@golinks/shared/keywords'
import { DEFAULT_ORGANIZATION_SETTINGS, type OrganizationSettings } from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import {
  findNamespaceConflicts,
  findNamespacesInUse,
  findPrefixFallbackViolations,
  namespaceChanges,
  planSettingsUpdate,
  recomputeCanonicalKeywords,
  revalidatesPrefixFallback,
  type SettingsLink,
  settingsChangeTouchesLinks,
  settingsRuleError,
} from './settings-rules.ts'

/** A settings document that differs from the defaults only where a test says so. */
type SettingsOverrides = Partial<Omit<OrganizationSettings, 'keywords'>> & {
  keywords?: Partial<KeywordRules>
}

function settings(overrides: SettingsOverrides = {}): OrganizationSettings {
  return {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    ...overrides,
    keywords: { ...DEFAULT_ORGANIZATION_SETTINGS.keywords, ...overrides.keywords },
  }
}

let nextId = 1

/**
 * A stored link. The keyword columns are derived the way the link service derives them for a
 * punctuation-sensitive organization, which is the state every one of these tests starts from.
 */
function link(displayKeyword: string, namespace = 'go'): SettingsLink {
  const segments = displayKeyword.split('/')
  return {
    id: nextId++,
    namespace,
    keyword: displayKeyword,
    displayKeyword,
    keywordPrefix: segments[0] ?? '',
    segmentCount: segments.length,
    placeholderCount: segments.filter((segment) => segment === '%s').length,
  }
}

const INSENSITIVE = settings({ keywords: { punctuationSensitive: false } })
const PREFIX_FALLBACK = settings({ keywords: { resolutionMode: 'prefixFallback' } })

describe('settingsChangeTouchesLinks', () => {
  it('is true for each field that describes the keyword space', () => {
    const before = settings()
    expect(settingsChangeTouchesLinks(before, settings({ defaultNamespace: 'links' }))).toBe(true)
    expect(settingsChangeTouchesLinks(before, settings({ namespaces: ['eng'] }))).toBe(true)
    expect(settingsChangeTouchesLinks(before, INSENSITIVE)).toBe(true)
    expect(settingsChangeTouchesLinks(before, PREFIX_FALLBACK)).toBe(true)
  })

  it('is false for the fields only the web app reads', () => {
    const after = settings({
      readOnly: true,
      admins: ['boss@acme.test'],
      banner: { text: 'Migration on Friday', url: null, level: 'info' },
    })
    expect(settingsChangeTouchesLinks(settings(), after)).toBe(false)
  })
})

describe('namespaceChanges', () => {
  it('separates the namespaces added from the ones taken away', () => {
    const before = settings({ namespaces: ['eng', 'docs'] })
    const after = settings({ namespaces: ['docs', 'ops'] })
    expect(namespaceChanges(before, after)).toEqual({ added: ['ops'], removed: ['eng'] })
  })

  it('reports nothing when the list only changes order', () => {
    const before = settings({ namespaces: ['eng', 'docs'] })
    const after = settings({ namespaces: ['docs', 'eng'] })
    expect(namespaceChanges(before, after)).toEqual({ added: [], removed: [] })
  })
})

describe('findNamespacesInUse', () => {
  it('counts the links standing in the way of a removal', () => {
    const links = [link('deploy', 'eng'), link('runbook', 'eng'), link('handbook')]
    expect(findNamespacesInUse(['eng'], links)).toEqual([{ namespace: 'eng', linkCount: 2 }])
  })

  it('lets an empty namespace go', () => {
    expect(findNamespacesInUse(['eng'], [link('handbook')])).toEqual([])
  })
})

describe('recomputeCanonicalKeywords', () => {
  it('drops punctuation from every segment when the rule is turned off', () => {
    const stored = link('meeting-notes/2026-09')

    const { projected } = recomputeCanonicalKeywords([stored], INSENSITIVE.keywords)

    expect(projected[0]?.columns).toEqual({
      keyword: 'meetingnotes/202609',
      displayKeyword: 'meeting-notes/2026-09',
      keywordPrefix: 'meetingnotes',
      segmentCount: 2,
      placeholderCount: 0,
    })
    expect(projected[0]?.changed).toBe(true)
  })

  it('puts the canonical keyword back to the display keyword when the rule is turned on', () => {
    const stored: SettingsLink = { ...link('meeting-notes'), keyword: 'meetingnotes' }

    const { projected } = recomputeCanonicalKeywords([stored], settings().keywords)

    expect(projected[0]?.columns.keyword).toBe('meeting-notes')
    expect(projected[0]?.changed).toBe(true)
  })

  it('leaves every column alone when the rule has not moved', () => {
    const { projected, collisions, invalid } = recomputeCanonicalKeywords(
      [link('handbook'), link('jira/%s')],
      settings().keywords,
    )

    expect(projected.every((entry) => !entry.changed)).toBe(true)
    expect(collisions).toEqual([])
    expect(invalid).toEqual([])
  })

  it('reports the links that would collapse onto one canonical keyword', () => {
    const { collisions } = recomputeCanonicalKeywords(
      [link('meeting-notes'), link('meetingnotes')],
      INSENSITIVE.keywords,
    )

    expect(collisions).toHaveLength(1)
    expect(collisions[0]?.keyword).toBe('meetingnotes')
    expect(collisions[0]?.links.map((entry) => entry.fullPath)).toEqual([
      'go/meeting-notes',
      'go/meetingnotes',
    ])
  })

  it('keeps each namespace to itself, since uniqueness is per namespace', () => {
    const { collisions } = recomputeCanonicalKeywords(
      [link('meeting-notes'), link('meetingnotes', 'eng')],
      INSENSITIVE.keywords,
    )

    expect(collisions).toEqual([])
  })

  it('reports a keyword left with nothing but punctuation', () => {
    const { invalid, projected } = recomputeCanonicalKeywords(
      [link('handbook'), link('--')],
      INSENSITIVE.keywords,
    )

    expect(invalid).toHaveLength(1)
    expect(invalid[0]?.fullPath).toBe('go/--')
    expect(projected).toHaveLength(1)
  })
})

describe('findNamespaceConflicts', () => {
  const rules = settings().keywords

  function projectionOf(links: SettingsLink[]) {
    return recomputeCanonicalKeywords(links, rules).projected
  }

  it('names the multi-segment keywords a new namespace would make ambiguous', () => {
    const projected = projectionOf([link('eng/deploy'), link('eng/runbook'), link('handbook')])

    const conflicts = findNamespaceConflicts(['eng'], projected, 'go', rules)

    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.links.map((entry) => entry.fullPath)).toEqual([
      'go/eng/deploy',
      'go/eng/runbook',
    ])
  })

  it('allows a single-segment keyword named after the namespace (spec 03 §2.5)', () => {
    expect(findNamespaceConflicts(['eng'], projectionOf([link('eng')]), 'go', rules)).toEqual([])
  })

  it('looks at the default namespace only', () => {
    const projected = projectionOf([link('eng/deploy', 'docs')])
    expect(findNamespaceConflicts(['eng'], projected, 'go', rules)).toEqual([])
  })

  it('compares canonically, so punctuation in the namespace name does not hide a clash', () => {
    const projected = recomputeCanonicalKeywords(
      [link('engtools/deploy')],
      INSENSITIVE.keywords,
    ).projected

    const conflicts = findNamespaceConflicts(['eng-tools'], projected, 'go', INSENSITIVE.keywords)

    expect(conflicts.map((conflict) => conflict.namespace)).toEqual(['eng-tools'])
  })
})

describe('revalidatesPrefixFallback', () => {
  it('is true when the mode is switched on', () => {
    expect(revalidatesPrefixFallback(settings(), PREFIX_FALLBACK)).toBe(true)
  })

  it('is true when punctuation moves inside the mode', () => {
    const after = settings({
      keywords: { resolutionMode: 'prefixFallback', punctuationSensitive: false } as never,
    })
    expect(revalidatesPrefixFallback(PREFIX_FALLBACK, after)).toBe(true)
  })

  it('is false for an unrelated change inside the mode', () => {
    const after = settings({
      namespaces: ['eng'],
      keywords: { resolutionMode: 'prefixFallback' } as never,
    })
    expect(revalidatesPrefixFallback(PREFIX_FALLBACK, after)).toBe(false)
  })

  it('is false while the organization resolves in the standard mode', () => {
    expect(revalidatesPrefixFallback(PREFIX_FALLBACK, settings())).toBe(false)
  })
})

describe('findPrefixFallbackViolations', () => {
  const rules = PREFIX_FALLBACK.keywords

  function projectionOf(links: SettingsLink[]) {
    return recomputeCanonicalKeywords(links, settings().keywords).projected
  }

  it('accepts the keywords the mode can resolve', () => {
    const violations = findPrefixFallbackViolations(
      projectionOf([link('handbook'), link('jira/%s'), link('gh/%s/%s')]),
      rules,
    )

    expect(violations).toEqual({ placeholders: [], prefixConflicts: [] })
  })

  it('rejects a hierarchical keyword, whose second segment is not a placeholder', () => {
    const violations = findPrefixFallbackViolations(projectionOf([link('docs/api')]), rules)

    expect(violations.placeholders.map((entry) => entry.fullPath)).toEqual(['go/docs/api'])
  })

  it('rejects a plain keyword sharing its segment with a programmatic one', () => {
    const violations = findPrefixFallbackViolations(
      projectionOf([link('example'), link('example/%s')]),
      rules,
    )

    expect(violations.prefixConflicts).toHaveLength(1)
    expect(violations.prefixConflicts[0]?.links.map((entry) => entry.fullPath)).toEqual([
      'go/example',
      'go/example/%s',
    ])
  })

  it('leaves the same pair alone in different namespaces', () => {
    const violations = findPrefixFallbackViolations(
      projectionOf([link('example'), link('example/%s', 'eng')]),
      rules,
    )

    expect(violations.prefixConflicts).toEqual([])
  })
})

describe('planSettingsUpdate', () => {
  it('plans the rename when the default namespace moves (spec 06 §3)', () => {
    const result = planSettingsUpdate({
      before: settings(),
      after: settings({ defaultNamespace: 'links' }),
      links: [link('handbook')],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.namespaceRewrite).toEqual({ from: 'go', to: 'links' })
    expect(result.plan.keywordUpdates).toEqual([])
  })

  it('plans a column rewrite for every link the punctuation rule moves', () => {
    const result = planSettingsUpdate({
      before: settings(),
      after: INSENSITIVE,
      links: [link('meeting-notes'), link('handbook')],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.keywordUpdates).toHaveLength(1)
    expect(result.plan.keywordUpdates[0]?.columns.keyword).toBe('meetingnotes')
  })

  it('plans nothing at all for a change that stays clear of the keyword space', () => {
    const result = planSettingsUpdate({
      before: settings(),
      after: settings({ readOnly: true }),
      links: [],
    })

    expect(result).toEqual({ ok: true, plan: { keywordUpdates: [], namespaceRewrite: null } })
  })

  it('refuses to remove a namespace that still holds links', () => {
    const result = planSettingsUpdate({
      before: settings({ namespaces: ['eng'] }),
      after: settings(),
      links: [link('deploy', 'eng')],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('namespace_in_use')
    expect(result.failure.details).toEqual({ namespaces: [{ namespace: 'eng', linkCount: 1 }] })
  })

  it('refuses a namespace that an existing keyword already uses as its first segment', () => {
    const result = planSettingsUpdate({
      before: settings(),
      after: settings({ namespaces: ['eng'] }),
      links: [link('eng/deploy')],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('namespace_conflicts')
  })

  it('refuses a punctuation toggle that would merge two keywords', () => {
    const result = planSettingsUpdate({
      before: settings(),
      after: INSENSITIVE,
      links: [link('meeting-notes'), link('meetingnotes')],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('keyword_conflict')
    expect(result.failure.message).toContain('meetingnotes')
  })

  it('refuses prefix fallback while a keyword the mode cannot resolve exists', () => {
    const result = planSettingsUpdate({
      before: settings(),
      after: PREFIX_FALLBACK,
      links: [link('docs/api')],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('keyword_conflict')
    expect(result.failure.details).toHaveProperty('placeholderViolations')
  })

  it('reports the namespace still in use before anything else', () => {
    const result = planSettingsUpdate({
      before: settings({ namespaces: ['eng'] }),
      after: settings({ namespaces: [], keywords: { punctuationSensitive: false } }),
      links: [link('deploy', 'eng'), link('meeting-notes'), link('meetingnotes')],
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.code).toBe('namespace_in_use')
  })
})

describe('settingsRuleError', () => {
  it('answers with the status the shared catalog gives the code', () => {
    const error = settingsRuleError({
      code: 'namespace_in_use',
      message: 'Move those links first.',
      details: { namespaces: [] },
    })

    expect(error.code).toBe('namespace_in_use')
    expect(error.status).toBe(409)
    expect(error.details).toEqual({ namespaces: [] })
  })
})

import {
  type OrganizationSettingsInput,
  OrganizationSettingsSchema,
} from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import {
  decodePathSegment,
  detectNamespace,
  parseResolverRequest,
  splitRequestPath,
} from './parse.ts'

function organization(input: OrganizationSettingsInput = {}) {
  return OrganizationSettingsSchema.parse({ namespaces: ['eng'], ...input })
}

const acme = organization()
const relaxed = organization({ keywords: { punctuationSensitive: false } })

/** Parses a raw request path the way the route does. */
function parsePath(pathname: string, settings = acme) {
  return parseResolverRequest(splitRequestPath(pathname), settings)
}

describe('splitRequestPath', () => {
  it('drops the surrounding separators, so a trailing slash changes nothing', () => {
    expect(splitRequestPath('/handbook')).toEqual(['handbook'])
    expect(splitRequestPath('/handbook/')).toEqual(['handbook'])
    expect(splitRequestPath('//handbook//')).toEqual(['handbook'])
  })

  it('reads the empty path as no keyword at all', () => {
    expect(splitRequestPath('/')).toEqual([])
    expect(splitRequestPath('')).toEqual([])
  })

  it('decodes one segment at a time, so an encoded slash stays inside its segment', () => {
    expect(splitRequestPath('/jira/a%20b')).toEqual(['jira', 'a b'])
    expect(splitRequestPath('/jira/a%2Fb')).toEqual(['jira', 'a/b'])
    expect(splitRequestPath('/docs/caf%C3%A9')).toEqual(['docs', 'café'])
  })

  it('leaves a segment alone when it is not valid encoding', () => {
    expect(splitRequestPath('/jira/100%25')).toEqual(['jira', '100%'])
    expect(decodePathSegment('%zz')).toBe('%zz')
  })
})

describe('detectNamespace', () => {
  it('finds a configured namespace', () => {
    expect(detectNamespace('eng', ['eng', 'docs'], acme.keywords)).toBe('eng')
  })

  it('does not treat an unconfigured name as one', () => {
    expect(detectNamespace('handbook', ['eng'], acme.keywords)).toBeUndefined()
  })

  it('compares in canonical form, so punctuation follows the organization', () => {
    expect(detectNamespace('engtools', ['eng-tools'], relaxed.keywords)).toBe('eng-tools')
    expect(detectNamespace('engtools', ['eng-tools'], acme.keywords)).toBeUndefined()
  })
})

describe('parseResolverRequest', () => {
  it('lowercases the first segment and leaves the rest alone', () => {
    const parsed = parsePath('/Jira/ACME-123')

    expect(parsed.namespace).toBe('go')
    expect(parsed.segments).toEqual(['jira', 'ACME-123'])
    expect(parsed.canonicalKeyword).toBe('jira/acme-123')
    expect(parsed.displayKeywordPath).toBe('jira/ACME-123')
  })

  it('reads a namespace only when something follows it', () => {
    const withRemainder = parsePath('/eng/deploy')
    expect(withRemainder.namespace).toBe('eng')
    expect(withRemainder.isDefaultNamespace).toBe(false)
    expect(withRemainder.canonicalKeyword).toBe('deploy')

    // `/eng` has no remainder, so it is the default-namespace keyword `eng` (spec 04 §9).
    const alone = parsePath('/eng')
    expect(alone.namespace).toBe('go')
    expect(alone.isDefaultNamespace).toBe(true)
    expect(alone.canonicalKeyword).toBe('eng')
  })

  it('does not treat the default namespace as a prefix to strip', () => {
    const parsed = parsePath('/go/handbook')

    expect(parsed.namespace).toBe('go')
    expect(parsed.canonicalKeyword).toBe('go/handbook')
  })

  it('keeps typed punctuation in the display form while the canonical form drops it', () => {
    const parsed = parsePath('/Meeting-Notes', relaxed)

    expect(parsed.displayKeywordPath).toBe('meeting-notes')
    expect(parsed.canonicalKeyword).toBe('meetingnotes')
  })

  it('leaves the canonical form equal to the display form when punctuation matters', () => {
    const parsed = parsePath('/meeting-notes')

    expect(parsed.displayKeywordPath).toBe('meeting-notes')
    expect(parsed.canonicalKeyword).toBe('meeting-notes')
  })

  it('canonicalizes every segment, not only the first', () => {
    const parsed = parsePath('/Meeting-Notes/2026-09', relaxed)

    expect(parsed.canonicalSegments).toEqual(['meetingnotes', '202609'])
    expect(parsed.segments).toEqual(['meeting-notes', '2026-09'])
  })

  it('respects a namespace spelled with different punctuation than it is configured with', () => {
    const settings = organization({
      namespaces: ['eng-tools'],
      keywords: { punctuationSensitive: false },
    })
    const parsed = parseResolverRequest(splitRequestPath('/ENG_TOOLS/deploy'), settings)

    expect(parsed.namespace).toBe('eng-tools')
    expect(parsed.canonicalKeyword).toBe('deploy')
  })
})

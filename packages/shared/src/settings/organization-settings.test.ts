import { describe, expect, it } from 'vitest'
import type { OrganizationSettings } from './organization-settings.ts'
import {
  DEFAULT_KEYWORD_ALLOWED_PATTERN,
  DEFAULT_ORGANIZATION_SETTINGS,
  OrganizationSettingsSchema,
  parseOrganizationSettings,
} from './organization-settings.ts'

/** A document with every field set away from its default, used for round-trip checks. */
const fullDocument: OrganizationSettings = {
  defaultNamespace: 'link',
  namespaces: ['eng', 'docs'],
  keywords: {
    allowedPattern: '^[a-z0-9._-]+(/([a-z0-9._-]+|%s))*$',
    punctuationSensitive: false,
    resolutionMode: 'prefixFallback',
  },
  editMode: 'anyMember',
  readOnly: true,
  admins: ['ops@acme.com', 'sre@acme.com'],
  banner: {
    text: 'Migration to the new wiki finishes Friday.',
    url: 'https://wiki.acme.com/migration',
    level: 'warning',
  },
  branding: {
    title: 'Acme GoLinks',
    logoUrl: 'https://static.acme.com/logo.svg',
    faviconUrl: '/static/favicon.ico',
    primaryColor: '#1f4b99',
    secondaryColor: '#d97706',
  },
  navigationLinks: [
    { text: 'Docs', url: 'https://wiki.acme.com/golinks', adminOnly: false },
    { text: 'Admin console', url: '/_/admin', adminOnly: true },
  ],
}

describe('defaults', () => {
  it('turns an empty document into a fully populated one', () => {
    expect(OrganizationSettingsSchema.parse({})).toEqual({
      defaultNamespace: 'go',
      namespaces: [],
      keywords: {
        allowedPattern: DEFAULT_KEYWORD_ALLOWED_PATTERN,
        punctuationSensitive: true,
        resolutionMode: 'standard',
      },
      editMode: 'ownersAndAdmins',
      readOnly: false,
      admins: [],
      banner: null,
      branding: {
        title: 'GoLinks',
        logoUrl: null,
        faviconUrl: null,
        primaryColor: null,
        secondaryColor: null,
      },
      navigationLinks: [],
    })
  })

  it('exports the empty document as DEFAULT_ORGANIZATION_SETTINGS', () => {
    expect(DEFAULT_ORGANIZATION_SETTINGS).toEqual(OrganizationSettingsSchema.parse({}))
  })

  it('fills in the sub-objects a document only partly specifies', () => {
    const settings = OrganizationSettingsSchema.parse({
      keywords: { punctuationSensitive: false },
      branding: { title: 'Acme GoLinks' },
      banner: { text: 'Read-only until noon.' },
      navigationLinks: [{ text: 'Docs', url: 'https://wiki.acme.com/golinks' }],
    })

    expect(settings.keywords).toEqual({
      allowedPattern: DEFAULT_KEYWORD_ALLOWED_PATTERN,
      punctuationSensitive: false,
      resolutionMode: 'standard',
    })
    expect(settings.branding.logoUrl).toBeNull()
    expect(settings.banner).toEqual({ text: 'Read-only until noon.', url: null, level: 'info' })
    expect(settings.navigationLinks[0]?.adminOnly).toBe(false)
  })

  it('defaults are themselves a valid document', () => {
    expect(OrganizationSettingsSchema.parse(DEFAULT_ORGANIZATION_SETTINGS)).toEqual(
      DEFAULT_ORGANIZATION_SETTINGS,
    )
  })
})

describe('round trip', () => {
  it('returns a fully specified document unchanged', () => {
    expect(OrganizationSettingsSchema.parse(fullDocument)).toEqual(fullDocument)
  })

  it('survives a trip through JSON', () => {
    const parsed = OrganizationSettingsSchema.parse(JSON.parse(JSON.stringify(fullDocument)))
    expect(parsed).toEqual(fullDocument)
  })
})

describe('normalization', () => {
  it('trims and lowercases admin emails', () => {
    const settings = OrganizationSettingsSchema.parse({ admins: ['  Ops@Acme.COM '] })
    expect(settings.admins).toEqual(['ops@acme.com'])
  })

  it('lowercases branding colors written in uppercase', () => {
    const settings = OrganizationSettingsSchema.parse({
      branding: { primaryColor: '#1F4B99' },
    })
    expect(settings.branding.primaryColor).toBe('#1f4b99')
  })

  it('trims surrounding whitespace from namespace names', () => {
    expect(OrganizationSettingsSchema.parse({ defaultNamespace: '  go  ' }).defaultNamespace).toBe(
      'go',
    )
  })
})

describe('namespaces', () => {
  it.each([
    ['uppercase letters', 'Go'],
    ['an underscore', 'go_links'],
    ['a slash', 'go/links'],
    ['an empty name', ''],
    ['more than 30 characters', 'a'.repeat(31)],
  ])('rejects a default namespace with %s', (_label, defaultNamespace) => {
    expect(OrganizationSettingsSchema.safeParse({ defaultNamespace }).success).toBe(false)
  })

  it('accepts a 30 character namespace name', () => {
    const defaultNamespace = 'a'.repeat(30)
    expect(OrganizationSettingsSchema.parse({ defaultNamespace }).defaultNamespace).toBe(
      defaultNamespace,
    )
  })

  it('rejects a namespace equal to the default namespace', () => {
    const result = parseOrganizationSettings({ defaultNamespace: 'go', namespaces: ['eng', 'go'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields['namespaces[1]']).toContain('already the default namespace')
  })

  it('rejects duplicate namespaces', () => {
    const result = parseOrganizationSettings({ namespaces: ['eng', 'eng'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields['namespaces[1]']).toContain('more than once')
  })

  it('rejects an invalid name inside the list', () => {
    const result = parseOrganizationSettings({ namespaces: ['eng', 'Docs'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields['namespaces[1]']).toBeDefined()
  })
})

describe('keywords', () => {
  it('rejects an allowed pattern that does not compile', () => {
    const result = parseOrganizationSettings({ keywords: { allowedPattern: '^([a-z' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields['keywords.allowedPattern']).toContain('valid regular expression')
  })

  it('rejects an empty allowed pattern', () => {
    expect(
      OrganizationSettingsSchema.safeParse({ keywords: { allowedPattern: '   ' } }).success,
    ).toBe(false)
  })

  it('accepts a loosened but compilable pattern', () => {
    const allowedPattern = '^[a-z0-9._-]+(/([a-z0-9._-]+|%s))*$'
    expect(
      OrganizationSettingsSchema.parse({ keywords: { allowedPattern } }).keywords.allowedPattern,
    ).toBe(allowedPattern)
  })

  it('rejects an unknown resolution mode', () => {
    expect(
      OrganizationSettingsSchema.safeParse({ keywords: { resolutionMode: 'fuzzy' } }).success,
    ).toBe(false)
  })

  it('rejects a non-boolean punctuationSensitive', () => {
    expect(
      OrganizationSettingsSchema.safeParse({ keywords: { punctuationSensitive: 'yes' } }).success,
    ).toBe(false)
  })

  it('rejects an unknown key inside keywords', () => {
    expect(
      OrganizationSettingsSchema.safeParse({ keywords: { caseSensitive: true } }).success,
    ).toBe(false)
  })
})

describe('editMode, readOnly, and admins', () => {
  it('rejects an unknown edit mode', () => {
    expect(OrganizationSettingsSchema.safeParse({ editMode: 'ownerOnly' }).success).toBe(false)
  })

  it('rejects a non-boolean readOnly', () => {
    expect(OrganizationSettingsSchema.safeParse({ readOnly: 'true' }).success).toBe(false)
  })

  it('rejects an admin entry that is not an email address', () => {
    const result = parseOrganizationSettings({ admins: ['ops'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields['admins[0]']).toBeDefined()
  })

  it('rejects the same admin listed twice, however it was capitalized', () => {
    const result = parseOrganizationSettings({ admins: ['ops@acme.com', 'OPS@acme.com'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields['admins[1]']).toContain('more than once')
  })
})

describe('banner', () => {
  it('accepts null', () => {
    expect(OrganizationSettingsSchema.parse({ banner: null }).banner).toBeNull()
  })

  it('rejects a banner without text', () => {
    expect(OrganizationSettingsSchema.safeParse({ banner: { level: 'info' } }).success).toBe(false)
  })

  it('rejects empty banner text', () => {
    expect(OrganizationSettingsSchema.safeParse({ banner: { text: '   ' } }).success).toBe(false)
  })

  it('rejects an unknown level', () => {
    expect(
      OrganizationSettingsSchema.safeParse({ banner: { text: 'Hi', level: 'critical' } }).success,
    ).toBe(false)
  })

  it('rejects a banner url with a dangerous scheme', () => {
    const result = parseOrganizationSettings({
      banner: { text: 'Hi', url: 'javascript:alert(1)' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields['banner.url']).toBeDefined()
  })
})

describe('branding', () => {
  it.each([
    ['no leading hash', '1f4b99'],
    ['three digits', '#fff'],
    ['a non-hex character', '#1f4b9g'],
    ['eight digits', '#1f4b99ff'],
  ])('rejects a primary color with %s', (_label, primaryColor) => {
    expect(OrganizationSettingsSchema.safeParse({ branding: { primaryColor } }).success).toBe(false)
  })

  it('accepts null colors and null urls', () => {
    const settings = OrganizationSettingsSchema.parse({
      branding: { logoUrl: null, faviconUrl: null, primaryColor: null, secondaryColor: null },
    })
    expect(settings.branding.primaryColor).toBeNull()
  })

  it('rejects an empty title', () => {
    expect(OrganizationSettingsSchema.safeParse({ branding: { title: '' } }).success).toBe(false)
  })

  it.each([
    ['a dangerous scheme', 'javascript:alert(1)'],
    ['a protocol-relative host', '//evil.example.com/logo.svg'],
    ['plain text', 'logo.svg'],
  ])('rejects a logo url with %s', (_label, logoUrl) => {
    expect(OrganizationSettingsSchema.safeParse({ branding: { logoUrl } }).success).toBe(false)
  })

  it('accepts a logo served by this deployment', () => {
    expect(
      OrganizationSettingsSchema.parse({ branding: { logoUrl: '/static/logo.svg' } }).branding
        .logoUrl,
    ).toBe('/static/logo.svg')
  })
})

describe('navigationLinks', () => {
  it('rejects an entry without text', () => {
    expect(
      OrganizationSettingsSchema.safeParse({ navigationLinks: [{ url: '/_/admin' }] }).success,
    ).toBe(false)
  })

  it('rejects an entry without a url', () => {
    expect(
      OrganizationSettingsSchema.safeParse({ navigationLinks: [{ text: 'Docs' }] }).success,
    ).toBe(false)
  })

  it('rejects a dangerous url', () => {
    const result = parseOrganizationSettings({
      navigationLinks: [{ text: 'Docs', url: 'javascript:alert(1)' }],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields['navigationLinks[0].url']).toBeDefined()
  })

  it('rejects an unknown key on an entry', () => {
    expect(
      OrganizationSettingsSchema.safeParse({
        navigationLinks: [{ text: 'Docs', url: '/_/admin', icon: 'book' }],
      }).success,
    ).toBe(false)
  })
})

describe('unknown fields', () => {
  it('rejects an unknown top-level key rather than dropping it', () => {
    const result = parseOrganizationSettings({ readonly: true })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields.settings).toContain('readonly')
  })
})

describe('parseOrganizationSettings', () => {
  it('returns the populated document on success', () => {
    const result = parseOrganizationSettings({})
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.settings).toEqual(DEFAULT_ORGANIZATION_SETTINGS)
  })

  it('rejects a document that is not an object', () => {
    const result = parseOrganizationSettings('nope')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('validation_failed')
    expect(result.error.fields.settings).toBeDefined()
  })

  it('reports one message per offending field', () => {
    const result = parseOrganizationSettings({
      defaultNamespace: 'GO',
      branding: { primaryColor: 'blue' },
      keywords: { allowedPattern: '^([a-z' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.error.fields).sort()).toEqual([
      'branding.primaryColor',
      'defaultNamespace',
      'keywords.allowedPattern',
    ])
  })
})

import { describe, expect, it } from 'vitest'
import {
  applyDeploymentSettingsOverrides,
  managedSettingsPaths,
  managedSettingsViolations,
  NO_DEPLOYMENT_OVERRIDES,
  parseDeploymentSettingsOverrides,
  settingsValueAt,
} from './deployment-overrides.ts'
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  OrganizationSettingsSchema,
} from './organization-settings.ts'

/** What a deployment that brands the service and pins its admins would supply. */
const ACME_OVERRIDES = {
  admins: ['ops@acme.com'],
  branding: {
    title: 'Acme Links',
    logoUrl: '/_/branding/logo.svg',
    primaryColor: '#1F4B99',
    dark: { backgroundColor: '#101418' },
  },
  navigationLinks: [{ text: 'Docs', url: 'https://wiki.acme.com/links' }],
  keywords: { allowedPattern: '^[a-z0-9._-]+$' },
}

function parsed(input: unknown) {
  const result = parseDeploymentSettingsOverrides(input)
  if (!result.ok) throw new Error(JSON.stringify(result.error.fields))
  return result.overrides
}

describe('parsing', () => {
  it('accepts an empty document and every field the deployment may fix', () => {
    expect(parsed({})).toEqual({})
    const overrides = parsed(ACME_OVERRIDES)
    expect(overrides.branding?.primaryColor).toBe('#1f4b99')
    expect(overrides.navigationLinks?.[0]?.adminOnly).toBe(false)
    expect(overrides.banner).toBeUndefined()
  })

  it('accepts a banner, or null to hide it, and read-only mode', () => {
    expect(parsed({ banner: null }).banner).toBeNull()
    expect(parsed({ banner: { text: 'Frozen for the audit.' } }).banner?.level).toBe('info')
    expect(parsed({ readOnly: true, editMode: 'anyMember' })).toEqual({
      readOnly: true,
      editMode: 'anyMember',
    })
  })

  it('refuses the fields whose change rewrites links, and says where to set them', () => {
    const result = parseDeploymentSettingsOverrides({
      defaultNamespace: 'links',
      namespaces: ['eng'],
      keywords: { punctuationSensitive: false, resolutionMode: 'prefixFallback' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.error.fields).sort()).toEqual([
      'defaultNamespace',
      'keywords.punctuationSensitive',
      'keywords.resolutionMode',
      'namespaces',
    ])
    expect(result.error.fields.defaultNamespace).toContain('golinks settings import')
    expect(result.error.fields['keywords.punctuationSensitive']).toContain('canonical keyword')
  })

  it('reports an unknown field by its path', () => {
    const result = parseDeploymentSettingsOverrides({ branding: { light: { accent: '#000000' } } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.fields).toEqual({ 'branding.light.accent': 'Unknown field.' })
  })

  it('validates values the same way the settings document does', () => {
    const result = parseDeploymentSettingsOverrides({
      branding: { primaryColor: 'blue', logoUrl: 'javascript:alert(1)' },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.error.fields).sort()).toEqual([
      'branding.logoUrl',
      'branding.primaryColor',
    ])
  })

  it('applies the whole-document rules too, such as distinct admins', () => {
    const result = parseDeploymentSettingsOverrides({ admins: ['ops@acme.com', 'OPS@acme.com'] })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(Object.keys(result.error.fields)).toEqual(['admins[1]'])
  })

  it('refuses a document that is not an object', () => {
    expect(parseDeploymentSettingsOverrides('{}').ok).toBe(false)
    expect(parseDeploymentSettingsOverrides(null).ok).toBe(false)
  })
})

describe('applying', () => {
  const stored = OrganizationSettingsSchema.parse({
    admins: ['jane@acme.com'],
    banner: { text: 'Stored banner.', url: null, level: 'warning' },
    branding: {
      title: 'Stored title',
      primaryColor: '#000000',
      secondaryColor: '#ffffff',
      dark: { primaryColor: '#abcdef', surfaceColor: '#123456' },
    },
    keywords: { punctuationSensitive: false },
    navigationLinks: [{ text: 'Old', url: '/old' }],
  })

  it('lays the deployment values over the stored document, field by field', () => {
    const effective = applyDeploymentSettingsOverrides(stored, parsed(ACME_OVERRIDES))
    expect(effective.branding.title).toBe('Acme Links')
    expect(effective.branding.primaryColor).toBe('#1f4b99')
    // Untouched by the overrides, so the stored value stands.
    expect(effective.branding.secondaryColor).toBe('#ffffff')
    expect(effective.branding.dark).toEqual({
      primaryColor: '#abcdef',
      secondaryColor: null,
      backgroundColor: '#101418',
      surfaceColor: '#123456',
    })
    expect(effective.keywords.allowedPattern).toBe('^[a-z0-9._-]+$')
    expect(effective.keywords.punctuationSensitive).toBe(false)
    expect(effective.banner?.text).toBe('Stored banner.')
  })

  it('replaces lists and the banner as a whole', () => {
    const effective = applyDeploymentSettingsOverrides(
      stored,
      parsed({ admins: ['ops@acme.com'], banner: { text: 'Fixed banner.' }, navigationLinks: [] }),
    )
    expect(effective.admins).toEqual(['ops@acme.com'])
    expect(effective.banner).toEqual({ text: 'Fixed banner.', url: null, level: 'info' })
    expect(effective.navigationLinks).toEqual([])
  })

  it('hides the banner when the deployment fixes it to null', () => {
    expect(applyDeploymentSettingsOverrides(stored, parsed({ banner: null })).banner).toBeNull()
  })

  it('leaves the document alone when there is nothing to override', () => {
    expect(applyDeploymentSettingsOverrides(stored, NO_DEPLOYMENT_OVERRIDES)).toEqual(stored)
    expect(applyDeploymentSettingsOverrides(DEFAULT_ORGANIZATION_SETTINGS, {})).toEqual(
      DEFAULT_ORGANIZATION_SETTINGS,
    )
  })
})

describe('managed paths', () => {
  it('names every fixed leaf, and a list or the banner as one path', () => {
    expect(
      managedSettingsPaths(parsed({ ...ACME_OVERRIDES, banner: null, readOnly: true })),
    ).toEqual([
      'admins',
      'banner',
      'branding.dark.backgroundColor',
      'branding.logoUrl',
      'branding.primaryColor',
      'branding.title',
      'keywords.allowedPattern',
      'navigationLinks',
      'readOnly',
    ])
    expect(managedSettingsPaths(NO_DEPLOYMENT_OVERRIDES)).toEqual([])
  })

  it('reads a value at a dotted path', () => {
    expect(settingsValueAt(DEFAULT_ORGANIZATION_SETTINGS, 'branding.title')).toBe('GoLinks')
    expect(settingsValueAt(DEFAULT_ORGANIZATION_SETTINGS, 'branding.dark.primaryColor')).toBeNull()
    expect(settingsValueAt(DEFAULT_ORGANIZATION_SETTINGS, 'branding.nothing.here')).toBeUndefined()
  })
})

describe('judging a write', () => {
  const overrides = parsed(ACME_OVERRIDES)
  const effective = applyDeploymentSettingsOverrides(DEFAULT_ORGANIZATION_SETTINGS, overrides)

  it('accepts a document that keeps every managed value', () => {
    expect(managedSettingsViolations(effective, overrides)).toEqual({})
    const elsewhere = OrganizationSettingsSchema.parse({
      ...effective,
      readOnly: true,
      branding: { ...effective.branding, secondaryColor: '#d97706' },
    })
    expect(managedSettingsViolations(elsewhere, overrides)).toEqual({})
  })

  it('names each managed path the document tries to change', () => {
    const attempt = OrganizationSettingsSchema.parse({
      ...effective,
      admins: ['ops@acme.com', 'jane@acme.com'],
      branding: { ...effective.branding, title: 'Mine', dark: { backgroundColor: '#000000' } },
    })
    const violations = managedSettingsViolations(attempt, overrides)
    expect(Object.keys(violations).sort()).toEqual([
      'admins',
      'branding.dark.backgroundColor',
      'branding.title',
    ])
    expect(violations.admins).toContain('fixed by the deployment')
  })

  it('compares the banner as a whole', () => {
    const fixed = parsed({ banner: { text: 'Fixed.', level: 'warning' } })
    const kept = applyDeploymentSettingsOverrides(DEFAULT_ORGANIZATION_SETTINGS, fixed)
    expect(managedSettingsViolations(kept, fixed)).toEqual({})
    const changed = OrganizationSettingsSchema.parse({ ...kept, banner: { text: 'Fixed.' } })
    expect(Object.keys(managedSettingsViolations(changed, fixed))).toEqual(['banner'])
  })
})

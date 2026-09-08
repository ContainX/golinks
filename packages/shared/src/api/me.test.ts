import { describe, expect, it } from 'vitest'
import { DEFAULT_KEYWORD_ALLOWED_PATTERN } from '../settings/index.ts'
import { AppInfoSchema, MeOrganizationSchema, MePatchBodySchema, MeSchema } from './me.ts'

/** The example from spec 05 section 2.2. */
const specMe = {
  user: {
    id: '7',
    email: 'jane@acme.com',
    role: 'admin',
    organizationId: 'acme.com',
    preferences: {},
    createdAt: '2026-01-10T09:00:00Z',
  },
  organization: {
    id: 'acme.com',
    defaultNamespace: 'go',
    namespaces: ['eng'],
    keywords: {
      allowedPattern: DEFAULT_KEYWORD_ALLOWED_PATTERN,
      punctuationSensitive: true,
      resolutionMode: 'standard',
    },
    editMode: 'ownersAndAdmins',
    readOnly: false,
    banner: null,
    branding: { title: 'GoLinks', logoUrl: null, primaryColor: null, secondaryColor: null },
    navigationLinks: [],
  },
  app: { baseUrl: 'https://links.example.com', shortHost: 'go', version: '1.0.0' },
}

describe('MeSchema', () => {
  it('parses the resource from the spec, filling in the branding fields it omits', () => {
    const me = MeSchema.parse(specMe)
    expect(me.user.email).toBe('jane@acme.com')
    expect(me.organization.branding.faviconUrl).toBeNull()
    expect(me.app.shortHost).toBe('go')
  })

  it('requires all three halves', () => {
    const { app: _app, ...withoutApp } = specMe
    expect(MeSchema.safeParse(withoutApp).success).toBe(false)
  })
})

describe('MeOrganizationSchema', () => {
  it('carries the organization id alongside the member-visible settings', () => {
    expect(MeOrganizationSchema.parse(specMe.organization).id).toBe('acme.com')
  })

  it('does not expose the admins list', () => {
    const parsed = MeOrganizationSchema.parse({
      ...specMe.organization,
      admins: ['ops@acme.com'],
    })
    expect(parsed).not.toHaveProperty('admins')
  })

  it('carries a banner when one is set', () => {
    const parsed = MeOrganizationSchema.parse({
      ...specMe.organization,
      banner: { text: 'Read-only until noon.', url: null, level: 'warning' },
    })
    expect(parsed.banner?.level).toBe('warning')
  })
})

describe('AppInfoSchema', () => {
  it('requires a usable base url', () => {
    expect(AppInfoSchema.safeParse({ ...specMe.app, baseUrl: 'links.example.com' }).success).toBe(
      false,
    )
  })
})

describe('MePatchBodySchema', () => {
  it('accepts whitelisted preferences', () => {
    expect(
      MePatchBodySchema.parse({ preferences: { dismissedNotices: ['short-host-setup'] } }),
    ).toEqual({ preferences: { dismissedNotices: ['short-host-setup'] } })
  })

  it('accepts an empty preferences document', () => {
    expect(MePatchBodySchema.parse({ preferences: {} })).toEqual({ preferences: {} })
  })

  it('requires the preferences wrapper', () => {
    expect(MePatchBodySchema.safeParse({ dismissedNotices: [] }).success).toBe(false)
    expect(MePatchBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects a preference key that is not whitelisted', () => {
    expect(MePatchBodySchema.safeParse({ preferences: { theme: 'dark' } }).success).toBe(false)
  })

  it('rejects an attempt to edit anything but preferences', () => {
    expect(MePatchBodySchema.safeParse({ preferences: {}, role: 'admin' }).success).toBe(false)
  })
})

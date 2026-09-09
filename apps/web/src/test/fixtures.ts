/**
 * Well-formed resources, as the API is contracted to return them (spec 05 §2).
 *
 * Every fixture is typed by the shared schema's own type, so a change to the
 * contract that these no longer satisfy is a compile error rather than a
 * puzzling test failure. Tests that need a malformed payload build it inline,
 * where the malformation is visible.
 */

import type {
  AdminUser,
  AppInfo,
  AuditEvent,
  Link,
  Me,
  MeOrganization,
  MeUser,
  Transfer,
  TransferPreview,
} from '@golinks/shared/api'
import type { OrganizationBranding, OrganizationSettings } from '@golinks/shared/settings'
import { DEFAULT_BRANDING_TITLE, DEFAULT_KEYWORD_ALLOWED_PATTERN } from '@golinks/shared/settings'

export function linkFixture(overrides: Partial<Link> = {}): Link {
  return {
    id: '42',
    namespace: 'go',
    keyword: 'meetingnotes',
    displayKeyword: 'meeting-notes',
    fullPath: 'go/meeting-notes',
    destination: 'https://docs.acme.com/notes',
    isProgrammatic: false,
    placeholderCount: 0,
    isUnlisted: false,
    owner: { id: '7', email: 'jane@acme.com' },
    visitCount: 128,
    lastVisitedAt: '2026-09-07T14:03:00Z',
    createdAt: '2026-01-10T09:00:00Z',
    updatedAt: '2026-08-30T16:20:00Z',
    permissions: { canEditDestination: true, canEdit: true, canDelete: true, canTransfer: true },
    ...overrides,
  }
}

export function brandingFixture(
  overrides: Partial<OrganizationBranding> = {},
): OrganizationBranding {
  return {
    title: DEFAULT_BRANDING_TITLE,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    secondaryColor: null,
    light: { primaryColor: null, secondaryColor: null, backgroundColor: null, surfaceColor: null },
    dark: { primaryColor: null, secondaryColor: null, backgroundColor: null, surfaceColor: null },
    ...overrides,
  }
}

export function settingsFixture(
  overrides: Partial<OrganizationSettings> = {},
): OrganizationSettings {
  return {
    defaultNamespace: 'go',
    namespaces: ['eng'],
    keywords: {
      allowedPattern: DEFAULT_KEYWORD_ALLOWED_PATTERN,
      punctuationSensitive: true,
      resolutionMode: 'standard',
    },
    editMode: 'ownersAndAdmins',
    readOnly: false,
    admins: ['ops@acme.com'],
    banner: null,
    branding: brandingFixture(),
    navigationLinks: [],
    ...overrides,
  }
}

export interface MeOverrides {
  user?: Partial<MeUser>
  organization?: Partial<MeOrganization>
  app?: Partial<AppInfo>
}

export function meFixture(overrides: MeOverrides = {}): Me {
  return {
    user: {
      id: '7',
      email: 'jane@acme.com',
      role: 'admin',
      organizationId: 'acme.com',
      preferences: {},
      createdAt: '2026-01-10T09:00:00Z',
      ...overrides.user,
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
      branding: brandingFixture(),
      navigationLinks: [],
      ...overrides.organization,
    },
    app: {
      baseUrl: 'https://links.example.com',
      shortHost: 'go',
      version: '1.0.0',
      managedSettings: [],
      ...overrides.app,
    },
  }
}

export function adminUserFixture(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: '7',
    email: 'jane@acme.com',
    role: 'admin',
    roleSource: 'idp',
    isEnabled: true,
    linkCount: 12,
    lastLoginAt: '2026-09-06T08:12:00Z',
    createdAt: '2026-01-10T09:00:00Z',
    ...overrides,
  }
}

export function transferFixture(overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: '3',
    url: 'https://links.example.com/_/transfer/tok-123',
    expiresAt: '2026-09-08T14:03:00Z',
    ...overrides,
  }
}

export function transferPreviewFixture(overrides: Partial<TransferPreview> = {}): TransferPreview {
  return {
    status: 'pending',
    link: {
      id: '42',
      fullPath: 'go/meeting-notes',
      destination: 'https://docs.acme.com/notes',
      owner: { id: '7', email: 'jane@acme.com' },
    },
    expiresAt: '2026-09-08T14:03:00Z',
    ...overrides,
  }
}

export function auditEventFixture(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: '901',
    type: 'link.created',
    actorUserId: '7',
    objectType: 'link',
    objectId: '42',
    data: { keyword: 'meeting-notes' },
    requestId: 'req-7',
    createdAt: '2026-09-07T14:03:00Z',
    ...overrides,
  }
}

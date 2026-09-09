// Settings a deployment fixes from the outside (spec 06 §6).
//
// Everything here is about the seam between a deployment's own configuration and an
// organization's stored document: what a member reads, what an admin is allowed to write, the
// files a deployment serves under its own branding, and the command line that imports and
// exports a document with the same rules as the API.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { API_BASE_PATH, MeSchema } from '@golinks/shared/api'
import type { EnvironmentInput } from '@golinks/shared/config'
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type DeploymentSettingsOverrides,
  type OrganizationSettings,
  parseDeploymentSettingsOverrides,
} from '@golinks/shared/settings'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  CLI_REQUEST_ID,
  type CommandOutput,
  exportSettingsCommand,
  importSettingsCommand,
  type SettingsCommandContext,
} from '../../src/cli/settings.ts'
import { auditEvents, organizations } from '../../src/db/schema/index.ts'
import { createOrganizationSettingsService } from '../../src/organizations/settings-service.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { buildIdentityApp, type SignedInSession, signIn } from './sign-in.ts'

const database = useTestDatabase()
const ME_URL = `${API_BASE_PATH}/me`
const SETTINGS_URL = `${API_BASE_PATH}/admin/settings`
const WIDGETS = TEST_ORGANIZATION_IDS.widgets
const GIZMOS = TEST_ORGANIZATION_IDS.gizmos
const ADMIN_GROUP = 'golinks-admins'

/** What the deployment in this suite fixes for every organization. */
const OVERRIDES_DOCUMENT = {
  readOnly: true,
  branding: {
    title: 'Acme Links',
    logoUrl: '/_/branding/logo.svg',
    dark: { backgroundColor: '#101014' },
  },
} as const

/** The same document, in the shape the settings service and the CLI take. */
const OVERRIDES: DeploymentSettingsOverrides = (() => {
  const parsed = parseDeploymentSettingsOverrides(OVERRIDES_DOCUMENT)
  if (!parsed.ok) throw new Error("the suite's own overrides document is not valid")
  return parsed.overrides
})()

const MANAGED_PATHS = [
  'branding.dark.backgroundColor',
  'branding.logoUrl',
  'branding.title',
  'readOnly',
]

function overrideEnvironment(extra: EnvironmentInput = {}): EnvironmentInput {
  return { SETTINGS_OVERRIDES_JSON: JSON.stringify(OVERRIDES_DOCUMENT), ...extra }
}

let app: GoLinksApp | undefined
let configDir: string

beforeAll(() => {
  configDir = mkdtempSync(join(tmpdir(), 'golinks-config-'))
  mkdirSync(join(configDir, 'branding'))
  writeFileSync(join(configDir, 'branding', 'logo.svg'), '<svg role="img"></svg>')
  writeFileSync(join(configDir, 'branding', '.secret'), 'not for anyone')
})

afterAll(() => {
  rmSync(configDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

function signInAdmin(instance: GoLinksApp, email: string): Promise<SignedInSession> {
  return signIn(instance, { email, groups: [ADMIN_GROUP], adminGroups: [ADMIN_GROUP] })
}

/** The document as it sits in the row, before any deployment value is laid over it. */
async function storedSettings(organizationId: string): Promise<OrganizationSettings | undefined> {
  const rows = await database()
    .db.select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
  return rows[0]?.settings
}

describe('GET /me under deployment overrides', () => {
  it('names the managed paths and answers with the effective settings', async () => {
    app = await buildIdentityApp({ database: database().db, environment: overrideEnvironment() })
    const session = await signIn(app)

    const body = MeSchema.parse(
      (await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })).json(),
    )

    expect(body.app.managedSettings).toEqual(MANAGED_PATHS)
    expect(body.organization.readOnly).toBe(true)
    expect(body.organization.branding.title).toBe('Acme Links')
    expect(body.organization.branding.logoUrl).toBe('/_/branding/logo.svg')
    expect(body.organization.branding.dark.backgroundColor).toBe('#101014')
    // Nothing the deployment left alone changed.
    expect(body.organization.branding.light.backgroundColor).toBeNull()
    expect(body.organization.defaultNamespace).toBe(DEFAULT_ORGANIZATION_SETTINGS.defaultNamespace)
  })

  it('fixes them for every organization, not just the first one that signs in', async () => {
    app = await buildIdentityApp({ database: database().db, environment: overrideEnvironment() })

    const widgets = MeSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: ME_URL,
          headers: (await signIn(app, { email: `ada@${WIDGETS}` })).headers,
        })
      ).json(),
    )
    const gizmos = MeSchema.parse(
      (
        await app.inject({
          method: 'GET',
          url: ME_URL,
          headers: (await signIn(app, { email: `grace@${GIZMOS}` })).headers,
        })
      ).json(),
    )

    expect(widgets.organization.id).toBe(WIDGETS)
    expect(gizmos.organization.id).toBe(GIZMOS)
    for (const body of [widgets, gizmos]) {
      expect(body.app.managedSettings).toEqual(MANAGED_PATHS)
      expect(body.organization.branding.title).toBe('Acme Links')
      expect(body.organization.readOnly).toBe(true)
    }
  })

  it('reports no managed settings when the deployment fixes none', async () => {
    app = await buildIdentityApp({ database: database().db })
    const session = await signIn(app)

    const body = MeSchema.parse(
      (await app.inject({ method: 'GET', url: ME_URL, headers: session.headers })).json(),
    )

    expect(body.app.managedSettings).toEqual([])
    expect(body.organization.branding.title).toBe(DEFAULT_ORGANIZATION_SETTINGS.branding.title)
  })
})

describe('PUT /admin/settings against a managed value', () => {
  async function readSettings(
    instance: GoLinksApp,
    session: SignedInSession,
  ): Promise<OrganizationSettings> {
    const response = await instance.inject({
      method: 'GET',
      url: SETTINGS_URL,
      headers: session.headers,
    })
    expect(response.statusCode).toBe(200)
    return response.json() as OrganizationSettings
  }

  it('is refused, with the managed path in the field report', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: overrideEnvironment(),
      identity: { memberCacheTtlMs: 0 },
    })
    const session = await signInAdmin(app, `boss@${WIDGETS}`)
    const current = await readSettings(app, session)

    const response = await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: session.apiHeaders,
      payload: {
        ...current,
        readOnly: false,
        branding: { ...current.branding, title: 'Something else' },
      },
    })

    expect(response.statusCode).toBe(400)
    const body = response.json()
    expect(body.error.code).toBe('validation_failed')
    expect(Object.keys(body.error.details.fields).sort()).toEqual(['branding.title', 'readOnly'])
    expect(body.error.details.fields['branding.title']).toContain('fixed by the deployment')

    // Nothing was written: the stored document is still the one the organization started with.
    expect(await storedSettings(WIDGETS)).toEqual(DEFAULT_ORGANIZATION_SETTINGS)
  })

  it('is accepted when the managed values are left as the deployment fixed them', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: overrideEnvironment(),
      identity: { memberCacheTtlMs: 0 },
    })
    const session = await signInAdmin(app, `boss@${WIDGETS}`)
    const current = await readSettings(app, session)

    const response = await app.inject({
      method: 'PUT',
      url: SETTINGS_URL,
      headers: session.apiHeaders,
      payload: { ...current, namespaces: ['eng'] },
    })

    expect(response.statusCode).toBe(200)
    const saved = response.json() as OrganizationSettings
    expect(saved.namespaces).toEqual(['eng'])
    expect(saved.branding.title).toBe('Acme Links')

    // The next read still has the deployment's values on it.
    const after = await readSettings(app, session)
    expect(after.namespaces).toEqual(['eng'])
    expect(after.readOnly).toBe(true)
  })
})

describe('GET /_/branding', () => {
  it('serves a file the deployment mounted, cached like any other asset', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: overrideEnvironment({ CONFIG_DIR: configDir }),
    })

    const response = await app.inject({ method: 'GET', url: '/_/branding/logo.svg' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/svg')
    expect(response.headers['cache-control']).toBe('public, max-age=3600')
    expect(response.body).toContain('<svg')
  })

  it('answers a name that is not there in the error envelope', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: overrideEnvironment({ CONFIG_DIR: configDir }),
    })

    const response = await app.inject({ method: 'GET', url: '/_/branding/missing.svg' })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('serves neither dotfiles nor a listing of the directory', async () => {
    app = await buildIdentityApp({
      database: database().db,
      environment: overrideEnvironment({ CONFIG_DIR: configDir }),
    })

    const dotfile = await app.inject({ method: 'GET', url: '/_/branding/.secret' })
    const listing = await app.inject({ method: 'GET', url: '/_/branding/' })

    expect(dotfile.statusCode).toBe(404)
    expect(dotfile.json().error.code).toBe('not_found')
    // A directory is refused rather than listed; either refusal is the error envelope.
    expect([403, 404]).toContain(listing.statusCode)
    expect(listing.body).not.toContain('logo.svg')
  })

  it('is never mistaken for a keyword', async () => {
    app = await buildIdentityApp({ database: database().db })

    const response = await app.inject({ method: 'GET', url: '/_/branding/logo.svg' })

    // No configuration directory: a 404 in the envelope, never a redirect to sign in.
    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })
})

describe('golinks settings import and export', () => {
  let files: string
  const lines: { out: string[]; err: string[] } = { out: [], err: [] }

  const output: CommandOutput = {
    out: (text) => lines.out.push(text),
    err: (text) => lines.err.push(text),
  }

  beforeAll(() => {
    files = mkdtempSync(join(tmpdir(), 'golinks-settings-'))
  })

  afterAll(() => {
    rmSync(files, { recursive: true, force: true })
  })

  beforeEach(() => {
    lines.out = []
    lines.err = []
  })

  /** A command context on the harness database, with the suite's deployment overrides. */
  function context(overrides = OVERRIDES): SettingsCommandContext {
    return {
      db: database().db,
      settings: createOrganizationSettingsService(database().db, { overrides }),
      output,
    }
  }

  function documentFile(name: string, document: unknown): string {
    const path = join(files, name)
    writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`)
    return path
  }

  function effective(document: Partial<OrganizationSettings> = {}): OrganizationSettings {
    return {
      ...DEFAULT_ORGANIZATION_SETTINGS,
      ...document,
      readOnly: true,
      branding: {
        ...DEFAULT_ORGANIZATION_SETTINGS.branding,
        ...document.branding,
        title: 'Acme Links',
        logoUrl: '/_/branding/logo.svg',
        dark: { ...DEFAULT_ORGANIZATION_SETTINGS.branding.dark, backgroundColor: '#101014' },
      },
    }
  }

  it('stores the document, creating the organization the way a first sign-in would', async () => {
    const path = documentFile('widgets.json', effective({ namespaces: ['eng'] }))

    const code = await importSettingsCommand(context(), WIDGETS, path)

    expect(code).toBe(0)
    expect(lines.err).toEqual([])
    expect(lines.out.join('')).toContain(WIDGETS)

    const stored = await storedSettings(WIDGETS)
    expect(stored?.namespaces).toEqual(['eng'])
  })

  it('records the change in the audit trail as a system action', async () => {
    const path = documentFile('audited.json', effective({ namespaces: ['docs'] }))

    expect(await importSettingsCommand(context(), WIDGETS, path)).toBe(0)

    const events = await database()
      .db.select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.organizationId, WIDGETS),
          eq(auditEvents.type, 'organization.settings_updated'),
        ),
      )
      .orderBy(asc(auditEvents.id))

    expect(events).toHaveLength(1)
    expect(events[0]?.actorUserId).toBeNull()
    expect(events[0]?.requestId).toBe(CLI_REQUEST_ID)
  })

  it('refuses a document that changes a value the deployment fixes', async () => {
    const path = documentFile('managed.json', { ...effective(), readOnly: false })

    const code = await importSettingsCommand(context(), WIDGETS, path)

    expect(code).toBe(1)
    expect(lines.out).toEqual([])
    expect(lines.err.join('')).toContain('readOnly')
    expect(lines.err.join('')).toContain('fixed by the deployment')
  })

  it('prints one line per field problem for a document that is not valid', async () => {
    const path = documentFile('invalid.json', { defaultNamespace: 'Not Valid', admins: ['nope'] })

    const code = await importSettingsCommand(context(), WIDGETS, path)

    expect(code).toBe(1)
    expect(lines.err).toHaveLength(2)
    expect(lines.err.join('')).toContain('defaultNamespace')
    expect(lines.err.join('')).toContain('admins')
  })

  it('reports a file that is not there', async () => {
    const code = await importSettingsCommand(context(), WIDGETS, join(files, 'nothing.json'))

    expect(code).toBe(1)
    expect(lines.err.join('')).toContain('could not be read')
  })

  it('prints the effective document, deployment values included', async () => {
    const path = documentFile('export.json', effective({ namespaces: ['eng'] }))
    expect(await importSettingsCommand(context(), GIZMOS, path)).toBe(0)
    lines.out = []

    const code = await exportSettingsCommand(context(), GIZMOS)

    expect(code).toBe(0)
    const printed = JSON.parse(lines.out.join('')) as OrganizationSettings
    expect(printed).toEqual(effective({ namespaces: ['eng'] }))
    // Pretty-printed, so the output can be edited and imported again.
    expect(lines.out.join('')).toContain('\n  "defaultNamespace"')
  })

  it('exports the defaults for an organization nobody has configured', async () => {
    const code = await exportSettingsCommand(context(), 'nobody.test')

    expect(code).toBe(0)
    expect(JSON.parse(lines.out.join(''))).toEqual(effective())
  })
})

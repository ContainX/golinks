// `golinks settings import` and `golinks settings export` (spec 06 §5).
//
// The import is the scripted form of `PUT /admin/settings`: the same document, the same
// validation, the same transaction, and the same audit event. It exists so that a deployment
// can set the fields it cannot fix from the outside — the default namespace, the namespace
// list, the keyword rules — without an admin clicking through the settings screen (spec 06 §6).
//
// The export prints the effective document: what a member's request would read, deployment
// overrides applied, so that a document can be exported from one environment, edited, and
// imported into another.
//
// Both commands honour the overrides the same way the service does: an imported document that
// changes a value the deployment fixes is refused, field by field, before anything is written.

import { readFileSync } from 'node:fs'
import { type OrganizationSettings, parseOrganizationSettings } from '@golinks/shared/settings'
import { updateOrganizationSettings } from '../admin/settings.ts'
import { loadDotEnvIfPresent } from '../config/dotenv.ts'
import { loadConfig } from '../config/load.ts'
import { createDatabaseConnection, type Database } from '../db/client.ts'
import { isApiError } from '../errors.ts'
import { loadDeploymentSettingsOverrides } from '../organizations/deployment-overrides.ts'
import {
  createOrganizationSettingsService,
  type OrganizationSettingsService,
} from '../organizations/settings-service.ts'

/**
 * The actor an imported change is recorded as.
 *
 * Nobody signed in, so there is no member to name: spec 07 §1 records a system action with no
 * actor, which is what a scheduled job leaves too. The request id says which system it was, so
 * the trail still distinguishes an import from the housekeeping jobs.
 */
export const CLI_REQUEST_ID = 'cli:settings-import'

/** Where a command writes. Injected so a test reads what it printed. */
export interface CommandOutput {
  out(text: string): void
  err(text: string): void
}

/** The process's own streams. */
export const processOutput: CommandOutput = {
  out: (text) => {
    process.stdout.write(text)
  },
  err: (text) => {
    process.stderr.write(text)
  },
}

export interface SettingsCommandContext {
  db: Database
  /** Built with the deployment's overrides, so managed values are honoured (spec 06 §6). */
  settings: OrganizationSettingsService
  output: CommandOutput
  /** Reads the document being imported. Injectable for tests. */
  readFile?: (path: string) => string
}

/** Organization ids are lowercase, as sign-in resolves them (spec 01 §1). */
function normalizeOrganizationId(value: string): string {
  return value.trim().toLowerCase()
}

/** Prints one line per field problem, in path order, and answers the exit code. */
function reportFields(output: CommandOutput, fields: Record<string, string>): number {
  for (const field of Object.keys(fields).sort()) {
    output.err(`${field}: ${fields[field] ?? ''}\n`)
  }
  return 1
}

/** Turns whatever a settings write threw into printed lines and an exit code. */
function reportWriteFailure(output: CommandOutput, error: unknown): number {
  if (!isApiError(error)) throw error

  const fields = (error.details as { fields?: Record<string, string> } | undefined)?.fields
  if (fields !== undefined && Object.keys(fields).length > 0) return reportFields(output, fields)

  output.err(`${error.message}\n`)
  return 1
}

/**
 * `golinks settings import <organization-id> <file.json>`.
 *
 * An organization nobody has signed in to yet is created first, exactly as a first sign-in
 * would create it, so a deployment can seed its settings before anyone arrives.
 */
export async function importSettingsCommand(
  context: SettingsCommandContext,
  organizationId: string,
  filePath: string,
): Promise<number> {
  const { output } = context
  const read = context.readFile ?? ((path: string) => readFileSync(path, 'utf8'))

  let text: string
  try {
    text = read(filePath)
  } catch (error) {
    output.err(`${filePath} could not be read: ${(error as Error).message}\n`)
    return 1
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(text)
  } catch (error) {
    output.err(`${filePath} is not valid JSON: ${(error as Error).message}\n`)
    return 1
  }

  const parsed = parseOrganizationSettings(parsedJson)
  if (!parsed.ok) return reportFields(output, parsed.error.fields)

  const id = normalizeOrganizationId(organizationId)
  await context.settings.ensureOrganization(id)

  try {
    await updateOrganizationSettings({
      db: context.db,
      settings: context.settings,
      organizationId: id,
      document: parsed.settings,
      actorUserId: null,
      requestId: CLI_REQUEST_ID,
    })
  } catch (error) {
    return reportWriteFailure(output, error)
  }

  output.out(`Settings for ${id} are updated from ${filePath}.\n`)
  return 0
}

/** `golinks settings export <organization-id>`: the effective document, as pretty JSON. */
export async function exportSettingsCommand(
  context: SettingsCommandContext,
  organizationId: string,
): Promise<number> {
  const settings: OrganizationSettings = await context.settings.getSettings(
    normalizeOrganizationId(organizationId),
  )
  context.output.out(`${JSON.stringify(settings, null, 2)}\n`)
  return 0
}

/**
 * Opens a connection, builds the settings service the way `index.ts` does, runs `body`, and
 * closes the connection again.
 */
async function withSettingsContext(
  output: CommandOutput,
  body: (context: SettingsCommandContext) => Promise<number>,
): Promise<number> {
  loadDotEnvIfPresent()
  const config = loadConfig()
  const overrides = loadDeploymentSettingsOverrides(config)

  const connection = createDatabaseConnection(config.databaseUrl, { maxConnections: 2 })
  try {
    const settings = createOrganizationSettingsService(connection.db, {
      overrides: overrides.overrides,
    })
    return await body({ db: connection.db, settings, output })
  } finally {
    await connection.close()
  }
}

/** Usage for the `settings` command, printed when its arguments do not make sense. */
export const SETTINGS_USAGE = `golinks settings <import|export>

  settings import <organization-id> <file.json>   Apply a settings document, with the same
                                                  rules and audit trail as the admin API.
  settings export <organization-id>               Print the effective settings document.
`

/** Dispatches `settings ...` from the command line. */
export async function runSettingsCommand(
  argv: readonly string[],
  output: CommandOutput = processOutput,
): Promise<number> {
  const [subcommand, organizationId, filePath] = argv

  if (subcommand === 'import') {
    if (organizationId === undefined || filePath === undefined) {
      output.err(`An organization id and a file are required.\n\n${SETTINGS_USAGE}`)
      return 2
    }
    return await withSettingsContext(output, (context) =>
      importSettingsCommand(context, organizationId, filePath),
    )
  }

  if (subcommand === 'export') {
    if (organizationId === undefined) {
      output.err(`An organization id is required.\n\n${SETTINGS_USAGE}`)
      return 2
    }
    return await withSettingsContext(output, (context) =>
      exportSettingsCommand(context, organizationId),
    )
  }

  output.err(
    subcommand === undefined
      ? SETTINGS_USAGE
      : `Unknown settings command "${subcommand}".\n\n${SETTINGS_USAGE}`,
  )
  return 2
}

// The `golinks` command line. Run it in development with
//   pnpm --filter @golinks/api migrate
// and in the container with
//   node apps/api/dist/cli.js migrate

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { runSettingsCommand } from './cli/settings.ts'
import { ConfigurationError } from './config/load.ts'
import { runMigrations } from './db/migrate.ts'

const USAGE = `golinks <command>

Commands:
  migrate
      Apply every pending database migration to DATABASE_URL.
  settings import <organization-id> <file.json>
      Apply an organization settings document, with the same rules and audit trail as the
      admin API. An organization nobody has signed in to yet is created first.
  settings export <organization-id>
      Print an organization's effective settings document as JSON.
  help
      Show this message.
`

/**
 * Fills the environment from the nearest .env when DATABASE_URL is not already set, so the
 * command works straight after copying .env.example. Values already in the environment win.
 */
function loadEnvironmentFile(): void {
  if (process.env.DATABASE_URL !== undefined) return

  // Run from apps/api by pnpm, or from the repository root by hand.
  for (const candidate of ['.env', '../.env', '../../.env']) {
    const path = resolve(process.cwd(), candidate)
    if (!existsSync(path)) continue
    process.loadEnvFile(path)
    return
  }
}

async function migrateCommand(): Promise<number> {
  loadEnvironmentFile()

  const connectionString = process.env.DATABASE_URL
  if (connectionString === undefined || connectionString.trim().length === 0) {
    process.stderr.write('DATABASE_URL is not set. Set it, or copy .env.example to .env.\n')
    return 1
  }

  const migrationsFolder = await runMigrations(connectionString)
  process.stdout.write(`Migrations from ${migrationsFolder} are applied.\n`)
  return 0
}

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0]

  switch (command) {
    case 'migrate':
      return migrateCommand()
    case 'settings':
      return runSettingsCommand(argv.slice(1))
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(USAGE)
      return 0
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`)
      return 2
  }
}

const exitCode = await main(process.argv.slice(2)).catch((error: unknown) => {
  // A configuration problem already reads as a list of what is wrong; a stack would only bury it.
  if (error instanceof ConfigurationError) {
    process.stderr.write(`${error.message}\n`)
    return 78 // EX_CONFIG
  }
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  )
  return 1
})

process.exit(exitCode)

// Applies the SQL migrations in `apps/api/drizzle` (spec 09 section 3).
//
// Migrations are versioned files checked into the repository. Drizzle records the ones it
// has run in `__drizzle_migrations`, so applying them a second time is a no-op.

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const MIGRATIONS_DIRECTORY_NAME = 'drizzle'
const JOURNAL_PATH = join('meta', '_journal.json')
const MAX_SEARCH_DEPTH = 6

/**
 * Finds the migrations directory by walking up from this module.
 *
 * The same code runs from two layouts: `src/db/migrate.ts` during development and tests,
 * and the bundled `dist/index.js` inside the container. Both sit under `apps/api`, so the
 * search finds `apps/api/drizzle` either way.
 */
export function resolveMigrationsFolder(startDirectory?: string): string {
  let directory = startDirectory ?? dirname(fileURLToPath(import.meta.url))

  for (let depth = 0; depth < MAX_SEARCH_DEPTH; depth += 1) {
    const candidate = join(directory, MIGRATIONS_DIRECTORY_NAME)
    if (existsSync(join(candidate, JOURNAL_PATH))) return candidate

    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }

  throw new Error(
    `No migrations directory found above ${startDirectory ?? dirname(fileURLToPath(import.meta.url))}. ` +
      'Expected a "drizzle" directory containing meta/_journal.json.',
  )
}

export interface RunMigrationsOptions {
  /** Overrides the directory search, which the integration harness uses. */
  migrationsFolder?: string
}

/**
 * Opens a single connection, applies every pending migration, and closes it again.
 * Resolves with the directory the migrations were read from.
 */
export async function runMigrations(
  connectionString: string,
  options: RunMigrationsOptions = {},
): Promise<string> {
  const migrationsFolder = options.migrationsFolder ?? resolveMigrationsFolder()

  // One connection: migrations are strictly sequential, and the pool goes away as soon as
  // they are done so a caller that only migrates does not keep the database busy.
  const sql = postgres(connectionString, { max: 1, onnotice: () => {} })
  try {
    await migrate(drizzle(sql), { migrationsFolder })
  } finally {
    await sql.end({ timeout: 5 })
  }

  return migrationsFolder
}

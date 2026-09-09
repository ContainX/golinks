// A local development database for machines without Docker.
//
// Starts an embedded Postgres (the same binaries the integration tests use) with its data
// under apps/api/.postgres-embedded, which is ignored by git, installs the extensions,
// applies pending migrations, prints the DATABASE_URL to use, and keeps the server running
// until interrupted. Docker Compose remains the primary path (spec 09 §2); this is the
// fallback when it is not available.

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import postgres from 'postgres'
import { runMigrations } from '../src/db/migrate.ts'

const PORT = Number(process.env.DEV_DB_PORT ?? 5433)
const USER = 'golinks'
const PASSWORD = 'golinks'
const DATABASE = 'golinks'
const DATA_DIR = process.env.DEV_DB_DIR ?? join(import.meta.dirname, '..', '.postgres-embedded')

async function main(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  const fresh = !existsSync(join(DATA_DIR, 'PG_VERSION'))

  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: USER,
    password: PASSWORD,
    persistent: true,
    onLog: () => {},
    onError: (message: unknown) => {
      process.stderr.write(`${String(message)}\n`)
    },
  })

  if (fresh) await server.initialise()
  await server.start()
  if (fresh) await server.createDatabase(DATABASE)

  const url = `postgres://${USER}:${PASSWORD}@127.0.0.1:${PORT}/${DATABASE}`
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  await sql`create extension if not exists pg_trgm`
  await sql`create extension if not exists citext`
  await sql.end()
  await runMigrations(url)

  process.stdout.write(`Embedded Postgres is ready.\nDATABASE_URL=${url}\nPress Ctrl+C to stop.\n`)

  const stop = async (): Promise<void> => {
    process.stdout.write('\nStopping embedded Postgres...\n')
    await server.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => void stop())
  process.once('SIGTERM', () => void stop())
  // Keep the event loop alive while the server runs.
  setInterval(() => {}, 60_000)
}

await main()

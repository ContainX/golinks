// The Postgres connection and the Drizzle instance built on top of it.
//
// One connection pool is shared by the whole process. `initializeDatabase` is called once
// at startup with the parsed DATABASE_URL; everything else reaches the database through
// `getDatabase()`.

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema/index.ts'

/** The Drizzle handle, typed against every table in `./schema`. */
export type Database = PostgresJsDatabase<typeof schema>

/** A pool and the Drizzle handle that writes through it. */
export interface DatabaseConnection {
  db: Database
  sql: postgres.Sql
  /** Drains the pool. Safe to call more than once. */
  close(): Promise<void>
}

export interface DatabaseOptions {
  /** Pool size. Defaults to postgres.js's own default. */
  maxConnections?: number
  /** Server notices, which are silenced unless a handler is given. */
  onNotice?: (notice: unknown) => void
}

/**
 * Opens a pool against `connectionString` and wraps it in Drizzle. Prefer
 * `initializeDatabase` for the application; this factory exists for tools and tests that
 * need a connection of their own.
 */
export function createDatabaseConnection(
  connectionString: string,
  options: DatabaseOptions = {},
): DatabaseConnection {
  const sql = postgres(connectionString, {
    ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
    onnotice: options.onNotice ?? (() => {}),
  })

  const db = drizzle(sql, { schema, casing: 'snake_case' })

  let closed = false
  return {
    db,
    sql,
    async close() {
      if (closed) return
      closed = true
      await sql.end({ timeout: 5 })
    },
  }
}

let connection: DatabaseConnection | undefined

/**
 * Opens the process-wide connection. Calling it twice without an intervening
 * `closeDatabase()` is a programming error.
 */
export function initializeDatabase(
  connectionString: string,
  options: DatabaseOptions = {},
): DatabaseConnection {
  if (connection !== undefined) {
    throw new Error('The database connection is already open; call closeDatabase() first.')
  }
  connection = createDatabaseConnection(connectionString, options)
  return connection
}

/** The process-wide connection, or a clear error when startup has not opened one. */
export function getDatabaseConnection(): DatabaseConnection {
  if (connection === undefined) {
    throw new Error('The database connection is not open; call initializeDatabase() first.')
  }
  return connection
}

/** The Drizzle handle for the process-wide connection. */
export function getDatabase(): Database {
  return getDatabaseConnection().db
}

/** The raw postgres.js handle, for advisory locks and other statements Drizzle does not model. */
export function getSql(): postgres.Sql {
  return getDatabaseConnection().sql
}

/** Drains the process-wide connection. A no-op when nothing is open. */
export async function closeDatabase(): Promise<void> {
  const open = connection
  connection = undefined
  if (open !== undefined) await open.close()
}

/**
 * Readiness probe for `GET /_/health/ready` (spec 05 section 3): runs `select 1` and
 * resolves when the database answers. Throws otherwise, so a readiness registry can report
 * 503 and log the reason.
 */
export async function checkDatabaseReady(target?: DatabaseConnection): Promise<void> {
  const sql = (target ?? getDatabaseConnection()).sql
  await sql`select 1`
}

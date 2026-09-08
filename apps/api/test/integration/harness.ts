// Integration test harness: a real Postgres with the schema applied.
//
// By default it starts a throwaway Postgres cluster in a temporary directory through
// `embedded-postgres`, so `pnpm --filter @golinks/api test:integration` needs nothing
// installed on the machine. Set GOLINKS_TEST_DATABASE_URL to point at an existing
// database instead, which is what CI does with a Postgres service container and what the
// `golinks_test` database in docker-compose.yml exists for.
//
// Whatever the source, the harness owns the database completely: `resetDatabase()`
// truncates every table, so never aim it at anything you want to keep.

import { randomBytes } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import EmbeddedPostgres from 'embedded-postgres'
import type postgres from 'postgres'
import { afterAll, beforeAll } from 'vitest'
import {
  createDatabaseConnection,
  type Database,
  type DatabaseConnection,
} from '../../src/db/client.ts'
import { runMigrations } from '../../src/db/migrate.ts'
import { TABLE_NAMES } from '../../src/db/schema/index.ts'

/** Environment variable that points the harness at an already-running database. */
export const TEST_DATABASE_URL_VARIABLE = 'GOLINKS_TEST_DATABASE_URL'

const EMBEDDED_USER = 'golinks'
const EMBEDDED_PASSWORD = 'golinks'
const EMBEDDED_DATABASE = 'golinks_test'

export interface TestDatabase {
  /** Connection string of the migrated database. */
  connectionString: string
  /** Drizzle handle, typed against every table. */
  db: Database
  /** Raw postgres.js handle, for assertions against the catalog. */
  sql: postgres.Sql
  /** True when the cluster was started by this process rather than supplied. */
  isEmbedded: boolean
}

/** A second database on the same cluster, for tests that need an unmigrated one. */
export interface ScratchDatabase {
  name: string
  connectionString: string
  /** Drops the database, disconnecting anything still attached to it. */
  drop(): Promise<void>
}

interface Cluster {
  connectionString: string
  isEmbedded: boolean
  stop(): Promise<void>
}

let started: Promise<TestDatabase> | undefined
let cluster: Cluster | undefined
let connection: DatabaseConnection | undefined

/** Asks the operating system for a port nothing else is using. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Could not determine a free port.')))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })
}

/** Replaces the database name in a Postgres connection string. */
export function withDatabaseName(connectionString: string, database: string): string {
  const url = new URL(connectionString)
  url.pathname = `/${database}`
  return url.toString()
}

async function startEmbeddedCluster(): Promise<Cluster> {
  const databaseDir = await mkdtemp(join(tmpdir(), 'golinks-postgres-'))
  const port = await findFreePort()

  const server = new EmbeddedPostgres({
    databaseDir,
    port,
    user: EMBEDDED_USER,
    password: EMBEDDED_PASSWORD,
    // The cluster lives only as long as the test file; nothing here is worth keeping.
    persistent: false,
    onLog: () => {},
    onError: () => {},
  })

  await server.initialise()
  await server.start()
  await server.createDatabase(EMBEDDED_DATABASE)

  return {
    connectionString: `postgres://${EMBEDDED_USER}:${EMBEDDED_PASSWORD}@127.0.0.1:${port}/${EMBEDDED_DATABASE}`,
    isEmbedded: true,
    async stop() {
      await server.stop()
      await rm(databaseDir, { recursive: true, force: true })
    },
  }
}

async function prepare(): Promise<TestDatabase> {
  const supplied = process.env[TEST_DATABASE_URL_VARIABLE]

  cluster =
    supplied === undefined || supplied.trim().length === 0
      ? await startEmbeddedCluster()
      : { connectionString: supplied.trim(), isEmbedded: false, stop: async () => {} }

  connection = createDatabaseConnection(cluster.connectionString, { maxConnections: 5 })

  // The compose init script installs these for the development database. Doing it here as
  // well means an embedded cluster, or a bare CI service container, is ready too. The
  // initial migration creates them a third time, which is what proves a plain Postgres
  // needs no preparation at all.
  await connection.sql`create extension if not exists pg_trgm`
  await connection.sql`create extension if not exists citext`

  await runMigrations(cluster.connectionString)

  return {
    connectionString: cluster.connectionString,
    db: connection.db,
    sql: connection.sql,
    isEmbedded: cluster.isEmbedded,
  }
}

/**
 * Starts the database and applies the migrations, once per process. Later calls return the
 * same handle, so several suites in one test file share the cost.
 */
export function startTestDatabase(): Promise<TestDatabase> {
  started ??= prepare()
  return started
}

/** Closes the connection and shuts down an embedded cluster. */
export async function stopTestDatabase(): Promise<void> {
  const pending = started
  started = undefined

  if (pending !== undefined) {
    // Let a failed startup settle before tearing down whatever it did manage to create.
    await pending.catch(() => {})
  }

  const openConnection = connection
  connection = undefined
  if (openConnection !== undefined) await openConnection.close()

  const runningCluster = cluster
  cluster = undefined
  if (runningCluster !== undefined) await runningCluster.stop()
}

/** Empties every table and restarts the identity sequences. */
export async function resetDatabase(): Promise<void> {
  const { sql } = await startTestDatabase()
  const tables = TABLE_NAMES.map((name) => `"${name}"`).join(', ')
  await sql.unsafe(`truncate table ${tables} restart identity cascade`)
}

/**
 * Creates an empty database beside the test database. Tests that need to watch migrations
 * run against something untouched use this and drop it again afterwards.
 */
export async function createScratchDatabase(): Promise<ScratchDatabase> {
  const { sql, connectionString } = await startTestDatabase()
  const name = `golinks_scratch_${randomBytes(6).toString('hex')}`

  await sql.unsafe(`create database "${name}"`)

  return {
    name,
    connectionString: withDatabaseName(connectionString, name),
    async drop() {
      await sql.unsafe(`drop database if exists "${name}" with (force)`)
    },
  }
}

/**
 * Registers the start and stop hooks for a test file and hands back an accessor for the
 * database. Call it once at the top of a suite:
 *
 * ```ts
 * const database = useTestDatabase()
 * ...
 * const { db } = database()
 * ```
 */
export function useTestDatabase(): () => TestDatabase {
  let handle: TestDatabase | undefined

  beforeAll(async () => {
    handle = await startTestDatabase()
  })

  afterAll(async () => {
    handle = undefined
    await stopTestDatabase()
  })

  return () => {
    if (handle === undefined) {
      throw new Error('The test database is not started yet; call useTestDatabase() first.')
    }
    return handle
  }
}

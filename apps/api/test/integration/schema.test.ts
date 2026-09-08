// The database schema, checked against a real Postgres.
//
// Everything here asserts against the catalog or against behaviour the specs require of
// the storage layer, not against the migration text: the point is that whatever ships in
// apps/api/drizzle produces the database specs 01, 02, 03, and 07 describe.

import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDatabaseConnection } from '../../src/db/client.ts'
import { runMigrations } from '../../src/db/migrate.ts'
import { links, linkTransfers, linkVisits, TABLE_NAMES, users } from '../../src/db/schema/index.ts'
import { insertLink, insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { createScratchDatabase, resetDatabase, useTestDatabase } from './harness.ts'

const database = useTestDatabase()

/** Postgres reports a unique violation as SQLSTATE 23505. */
const UNIQUE_VIOLATION = '23505'

/** The driver error may arrive wrapped, so follow the cause chain looking for a SQLSTATE. */
function sqlStateOf(error: unknown): string | undefined {
  let current = error
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string') return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

async function expectUniqueViolation(action: Promise<unknown>): Promise<void> {
  const rejection = await action.then(
    () => undefined,
    (reason: unknown) => ({ reason }),
  )

  expect(rejection, 'expected the write to be rejected').toBeDefined()
  expect(sqlStateOf(rejection?.reason)).toBe(UNIQUE_VIOLATION)
}

beforeEach(async () => {
  await resetDatabase()
})

describe('migrations', () => {
  it('applies to a database with nothing in it, and is a no-op the second time', async () => {
    const scratch = await createScratchDatabase()

    try {
      await runMigrations(scratch.connectionString)

      // Connect to the scratch database to read what the migration built.
      const connection = createDatabaseConnection(scratch.connectionString, { maxConnections: 2 })

      try {
        const tables = await connection.sql<{ table_name: string }[]>`
          select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
        `
        expect(tables.map((row) => row.table_name).sort()).toEqual([...TABLE_NAMES].sort())

        // The migration installs the extensions itself, so a plain Postgres with no init
        // script is enough (spec 09 sections 1 and 3).
        const extensions = await connection.sql<{ extname: string }[]>`
          select extname from pg_extension where extname in ('pg_trgm', 'citext')
        `
        expect(extensions.map((row) => row.extname).sort()).toEqual(['citext', 'pg_trgm'])

        const countApplied = async (): Promise<number> => {
          const rows = await connection.sql<{ count: string }[]>`
            select count(*)::text as count from drizzle.__drizzle_migrations
          `
          return Number(rows[0]?.count ?? '0')
        }

        const afterFirstRun = await countApplied()
        expect(afterFirstRun).toBeGreaterThan(0)

        // Running the migrator again applies nothing and leaves the ledger alone.
        await runMigrations(scratch.connectionString)
        expect(await countApplied()).toBe(afterFirstRun)
      } finally {
        await connection.close()
      }
    } finally {
      await scratch.drop()
    }
  })
})

describe('extensions and indexes', () => {
  it('has pg_trgm and citext installed', async () => {
    const { sql: query } = database()

    const rows = await query<{ extname: string }[]>`
      select extname from pg_extension where extname in ('pg_trgm', 'citext')
    `

    expect(rows.map((row) => row.extname).sort()).toEqual(['citext', 'pg_trgm'])
  })

  it('indexes display_keyword and destination with trigram GIN indexes', async () => {
    const { sql: query } = database()

    const rows = await query<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef from pg_indexes
      where schemaname = 'public' and tablename = 'links'
    `
    const definitions = new Map(rows.map((row) => [row.indexname, row.indexdef]))

    for (const [name, column] of [
      ['links_display_keyword_trgm_idx', 'display_keyword'],
      ['links_destination_trgm_idx', 'destination'],
    ] as const) {
      const definition = definitions.get(name)
      expect(definition, `${name} is missing`).toBeDefined()
      expect(definition).toContain('USING gin')
      expect(definition).toContain(`${column} gin_trgm_ops`)
    }
  })

  it('indexes the lookups the resolver and directory depend on', async () => {
    const { sql: query } = database()

    const rows = await query<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'public' and tablename = 'links'
    `
    const names = new Set(rows.map((row) => row.indexname))

    expect(names).toContain('links_organization_namespace_keyword_key')
    expect(names).toContain('links_organization_namespace_prefix_idx')
    expect(names).toContain('links_organization_owner_idx')
  })
})

describe('links', () => {
  it('rejects a second link with the same organization, namespace, and keyword', async () => {
    const { db } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    const owner = await insertUser(db, {
      email: 'ada@widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })

    await insertLink(db, {
      organizationId: TEST_ORGANIZATION_IDS.widgets,
      ownerId: owner.id,
      keyword: 'handbook',
    })

    await expectUniqueViolation(
      insertLink(db, {
        organizationId: TEST_ORGANIZATION_IDS.widgets,
        ownerId: owner.id,
        keyword: 'handbook',
        destination: 'https://elsewhere.test/',
      }),
    )
  })

  it('lets the same keyword exist in another namespace and in another organization', async () => {
    const { db } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    await insertOrganization(db, TEST_ORGANIZATION_IDS.gizmos)

    const widgetsOwner = await insertUser(db, {
      email: 'ada@widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })
    const gizmosOwner = await insertUser(db, {
      email: 'grace@gizmos.test',
      organizationId: TEST_ORGANIZATION_IDS.gizmos,
    })

    await insertLink(db, {
      organizationId: TEST_ORGANIZATION_IDS.widgets,
      ownerId: widgetsOwner.id,
      keyword: 'handbook',
    })
    await insertLink(db, {
      organizationId: TEST_ORGANIZATION_IDS.widgets,
      ownerId: widgetsOwner.id,
      keyword: 'handbook',
      namespace: 'eng',
    })
    await insertLink(db, {
      organizationId: TEST_ORGANIZATION_IDS.gizmos,
      ownerId: gizmosOwner.id,
      keyword: 'handbook',
    })

    const rows = await db.select().from(links)
    expect(rows).toHaveLength(3)
  })

  it('starts visit counters at zero and leaves last_visited_at unset', async () => {
    const { db } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    const owner = await insertUser(db, {
      email: 'ada@widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })

    const link = await insertLink(db, {
      organizationId: TEST_ORGANIZATION_IDS.widgets,
      ownerId: owner.id,
      keyword: 'handbook',
    })

    expect(link.visitCount).toBe(0)
    expect(link.lastVisitedAt).toBeNull()
    expect(link.isUnlisted).toBe(false)
    expect(link.placeholderCount).toBe(0)
  })
})

describe('users.email', () => {
  it('is unique regardless of case', async () => {
    const { db } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    await insertUser(db, {
      email: 'Ada@Widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })

    await expectUniqueViolation(
      insertUser(db, {
        email: 'ada@widgets.test',
        organizationId: TEST_ORGANIZATION_IDS.widgets,
      }),
    )
  })

  it('matches regardless of case on lookup', async () => {
    const { db } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    const stored = await insertUser(db, {
      email: 'Ada@Widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })

    const found = await db.select().from(users).where(eq(users.email, 'ADA@WIDGETS.TEST'))

    expect(found).toHaveLength(1)
    expect(found[0]?.id).toBe(stored.id)
  })
})

describe('deleting a link', () => {
  it('takes its transfers and its visit records with it', async () => {
    const { db } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    const owner = await insertUser(db, {
      email: 'ada@widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })
    const colleague = await insertUser(db, {
      email: 'linus@widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })

    const doomed = await insertLink(db, {
      organizationId: TEST_ORGANIZATION_IDS.widgets,
      ownerId: owner.id,
      keyword: 'handbook',
    })
    const survivor = await insertLink(db, {
      organizationId: TEST_ORGANIZATION_IDS.widgets,
      ownerId: owner.id,
      keyword: 'roadmap',
    })

    for (const link of [doomed, survivor]) {
      await db.insert(linkTransfers).values({
        linkId: link.id,
        tokenHash: `hash-${link.id}`,
        createdById: owner.id,
        expectedOwnerId: owner.id,
        expiresAt: new Date(Date.now() + 60_000),
      })
      await db.insert(linkVisits).values({
        linkId: link.id,
        organizationId: TEST_ORGANIZATION_IDS.widgets,
        userId: colleague.id,
        via: 'browser',
      })
    }

    await db.delete(links).where(eq(links.id, doomed.id))

    const remainingTransfers = await db.select().from(linkTransfers)
    const remainingVisits = await db.select().from(linkVisits)

    expect(remainingTransfers.map((row) => row.linkId)).toEqual([survivor.id])
    expect(remainingVisits.map((row) => row.linkId)).toEqual([survivor.id])
  })

  it('keeps the owner, who is never deleted', async () => {
    const { db } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    const owner = await insertUser(db, {
      email: 'ada@widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })
    const link = await insertLink(db, {
      organizationId: TEST_ORGANIZATION_IDS.widgets,
      ownerId: owner.id,
      keyword: 'handbook',
    })

    await db.delete(links).where(eq(links.id, link.id))

    const remaining = await db.select().from(users)
    expect(remaining).toHaveLength(1)
  })
})

describe('resetDatabase', () => {
  afterEach(async () => {
    await resetDatabase()
  })

  it('empties every table and restarts the identity sequences', async () => {
    const { db, sql: query } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    const first = await insertUser(db, {
      email: 'ada@widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })

    await resetDatabase()

    const counts = await query<{ organizations: string; users: string }[]>`
      select
        (select count(*)::text from organizations) as organizations,
        (select count(*)::text from users) as users
    `
    expect(counts[0]).toEqual({ organizations: '0', users: '0' })

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)
    const second = await insertUser(db, {
      email: 'grace@widgets.test',
      organizationId: TEST_ORGANIZATION_IDS.widgets,
    })
    expect(second.id).toBe(first.id)
  })
})

describe('audit events', () => {
  it('keeps rows for an organization that no longer has the actor on hand', async () => {
    const { db, sql: query } = database()

    await insertOrganization(db, TEST_ORGANIZATION_IDS.widgets)

    // Spec 07 section 1 gives audit_events a plain organization_id and a nullable actor, so
    // a system action records without any user at all.
    await query`
      insert into audit_events (organization_id, type, object_type, object_id)
      values (${TEST_ORGANIZATION_IDS.widgets}, 'organization.settings_updated', 'organization',
              ${TEST_ORGANIZATION_IDS.widgets})
    `

    const rows = await query<{ actor_user_id: string | null }[]>`
      select actor_user_id from audit_events
    `
    expect(rows).toHaveLength(1)
    expect(rows[0]?.actor_user_id).toBeNull()
  })
})

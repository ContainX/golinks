// Measures the resolver against the targets of spec 04 §10.
//
//   pnpm --filter @golinks/api exec tsx scripts/bench-resolver.ts
//
// It starts the same throwaway Postgres the integration harness uses, seeds an organization
// with a few thousand links, signs a member in, and then drives hits through `app.inject()`.
// Two things come out: how long a hit takes, and how many SQL statements one costs.
//
// What is being measured is the hot path — the session, the organization's settings, and the
// link lookup. Visit recording is explicitly off that path (spec 04 §6), so the recorder writes
// through a second handle that the statement counter does not watch; the writes still happen,
// against the same pool, so they still compete for connections the way they do in production.
//
// `app.inject()` skips the socket, which is what "excluding network" in the target means.

import { drizzle } from 'drizzle-orm/postgres-js'
import { createPostgresSessionStore } from '../src/auth/session-stores.ts'
import type { Database } from '../src/db/client.ts'
import * as schema from '../src/db/schema/index.ts'
import { links, organizations, users } from '../src/db/schema/index.ts'
import { createDatabaseVisitWriter, createVisitRecorder } from '../src/resolver/visits.ts'
import type { GoLinksApp } from '../src/types.ts'
import { resetDatabase, startTestDatabase, stopTestDatabase } from '../test/integration/harness.ts'
import { buildIdentityApp, signIn, TEST_MEMBER_EMAIL } from '../test/integration/sign-in.ts'

/** Enough links that the keyword index, rather than a sequential scan, is what answers. */
const SEEDED_LINKS = Number(process.env.BENCH_LINKS ?? 5_000)
/** Hits that count towards the reported percentiles. */
const MEASURED_HITS = Number(process.env.BENCH_HITS ?? 2_000)
/** Hits that only warm the caches, the pool, and the JIT. */
const WARMUP_HITS = Number(process.env.BENCH_WARMUP ?? 300)
/** Hits whose statements are counted one at a time. */
const COUNTED_HITS = 50

const ORGANIZATION = 'widgets.test'
const INSERT_CHUNK = 500

interface Measurement {
  p50: number
  p99: number
  min: number
  max: number
  mean: number
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))
  return sorted[index] ?? 0
}

function summarize(durations: readonly number[]): Measurement {
  const sorted = [...durations].sort((left, right) => left - right)
  const total = sorted.reduce((sum, value) => sum + value, 0)
  return {
    p50: percentile(sorted, 0.5),
    p99: percentile(sorted, 0.99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sorted.length === 0 ? 0 : total / sorted.length,
  }
}

function milliseconds(value: number): string {
  return `${value.toFixed(2)} ms`
}

/** The keyword the nth seeded link answers to. */
function keywordOf(index: number): string {
  return `link-${index}`
}

/** Seeds the organization, an owner for the links, and `SEEDED_LINKS` distinct keywords. */
async function seed(db: Database): Promise<void> {
  await db.insert(organizations).values({ id: ORGANIZATION, settings: {} as never })

  const [owner] = await db
    .insert(users)
    .values({ email: `owner@${ORGANIZATION}`, organizationId: ORGANIZATION, role: 'member' })
    .returning({ id: users.id })
  if (owner === undefined) throw new Error('The link owner was not created.')

  for (let start = 0; start < SEEDED_LINKS; start += INSERT_CHUNK) {
    const rows = []
    for (let index = start; index < Math.min(start + INSERT_CHUNK, SEEDED_LINKS); index += 1) {
      const keyword = keywordOf(index)
      rows.push({
        organizationId: ORGANIZATION,
        namespace: 'go',
        keyword,
        displayKeyword: keyword,
        keywordPrefix: keyword,
        segmentCount: 1,
        placeholderCount: 0,
        destination: `https://wiki.acme.com/pages/${index}`,
        ownerId: owner.id,
        createdById: owner.id,
        isUnlisted: false,
      })
    }
    await db.insert(links).values(rows)
  }
}

async function main(): Promise<void> {
  process.stdout.write('Starting Postgres and applying migrations...\n')
  const { sql, isEmbedded, connectionString } = await startTestDatabase()
  await resetDatabase()

  // Two handles over one pool. Everything on the hot path goes through the counted one; the
  // visit writes, which spec 04 §6 puts after the response, go through the other.
  let statements: string[] = []
  let counting = false
  const countedDb = drizzle(sql, {
    schema,
    casing: 'snake_case',
    logger: {
      logQuery(query: string) {
        if (counting) statements.push(query)
      },
    },
  })
  const plainDb = drizzle(sql, { schema, casing: 'snake_case' })

  process.stdout.write(`Seeding ${SEEDED_LINKS} links...\n`)
  await seed(plainDb)

  const app: GoLinksApp = await buildIdentityApp({
    database: countedDb,
    // The limiter stays switched on, so its hook is part of what is timed; the budget is
    // simply lifted above anything this run will spend (spec 05 §5).
    environment: { RATE_LIMIT_RESOLVER: String(MEASURED_HITS + WARMUP_HITS + COUNTED_HITS + 1000) },
    // The sessions table, so the session round trips are part of what is counted. A deployment
    // with REDIS_URL set trades them for one Redis read (spec 02 §3, spec 04 §10).
    sessionStore: createPostgresSessionStore(countedDb, { maxAgeMs: 2_592_000_000 }),
    plugins: [
      (instance) => {
        instance.decorate(
          'visitRecorder',
          createVisitRecorder({
            write: createDatabaseVisitWriter(() => plainDb),
            logger: instance.log,
          }),
        )
      },
    ],
  })

  const session = await signIn(app, { email: TEST_MEMBER_EMAIL })

  async function hit(index: number): Promise<number> {
    const startedAt = process.hrtime.bigint()
    const response = await app.inject({
      method: 'GET',
      url: `/${keywordOf(index % SEEDED_LINKS)}`,
      headers: session.headers,
    })
    const elapsed = Number(process.hrtime.bigint() - startedAt) / 1_000_000
    if (response.statusCode !== 302) {
      throw new Error(`A hit answered ${response.statusCode}, not a redirect: ${response.body}`)
    }
    return elapsed
  }

  process.stdout.write(`Warming up with ${WARMUP_HITS} hits...\n`)
  for (let index = 0; index < WARMUP_HITS; index += 1) await hit(index)

  process.stdout.write(`Measuring ${MEASURED_HITS} hits...\n`)
  const durations: number[] = []
  for (let index = 0; index < MEASURED_HITS; index += 1) durations.push(await hit(index))

  // A second pass, one hit at a time, so each hit's statements can be attributed to it.
  const perHit: number[] = []
  let sample: string[] = []
  for (let index = 0; index < COUNTED_HITS; index += 1) {
    statements = []
    counting = true
    await hit(index)
    counting = false
    perHit.push(statements.length)
    if (index === COUNTED_HITS - 1) sample = statements
  }

  const latency = summarize(durations)
  const worst = Math.max(...perHit)
  const typical = perHit.slice().sort((left, right) => left - right)[Math.floor(perHit.length / 2)]

  await app.close()
  await stopTestDatabase()

  const lines = [
    '',
    'Resolver benchmark (spec 04 §10)',
    '================================',
    `database            ${isEmbedded ? 'embedded Postgres' : connectionString}`,
    `links seeded        ${SEEDED_LINKS}`,
    `hits measured       ${MEASURED_HITS} (after ${WARMUP_HITS} warm-up hits)`,
    '',
    'Server time on a hit with a warm session, excluding network',
    `  p50               ${milliseconds(latency.p50)}   (target: under 10 ms)`,
    `  p99               ${milliseconds(latency.p99)}   (target: under 50 ms)`,
    `  min / mean / max  ${milliseconds(latency.min)} / ${milliseconds(latency.mean)} / ${milliseconds(latency.max)}`,
    '',
    'SQL statements on the hot path, per hit',
    `  typical           ${typical}   (target: at most 3)`,
    `  worst of ${String(COUNTED_HITS).padEnd(3)}      ${worst}`,
    '  one hit issued:',
    ...sample.map((statement) => `    - ${statement}`),
    '',
    `verdict             ${latency.p50 < 10 && latency.p99 < 50 && worst <= 3 ? 'targets met' : 'targets NOT met'}`,
    '',
  ]
  process.stdout.write(lines.join('\n'))
}

await main()

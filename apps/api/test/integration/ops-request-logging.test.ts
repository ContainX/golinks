// The log lines a running service actually emits (spec 09 §5).
//
// The builders have their own unit tests; what this suite pins down is that the lines reaching
// stdout carry the fields an operator needs and none of the things a log line must never hold:
// a full destination, a cookie, or an Authorization header.

import { beforeEach, describe, expect, it } from 'vitest'
import { buildLoggerOptions } from '../../src/logging.ts'
import { buildTestApp, testConfig } from '../../src/testing/fixtures.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertLink } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  RESOLVER_ORGANIZATION,
  type SeededOrganization,
  seedExampleOrganization,
} from './resolver-fixtures.ts'

const database = useTestDatabase()

beforeEach(async () => {
  await resetDatabase()
})

/** The `res` object of a completion line, which is where spec 09 §5's fields live. */
function completionOf(line: Record<string, unknown> | undefined): Record<string, unknown> {
  const res = line?.res
  if (res === null || typeof res !== 'object') throw new Error('No completion line was logged.')
  return res as Record<string, unknown>
}

interface LoggedApp {
  app: GoLinksApp
  seeded: SeededOrganization
  lines: Record<string, unknown>[]
  /** Every line whose message is `message`. */
  linesFor(message: string): Record<string, unknown>[]
}

/** An app logging through the real options, into an array this suite can read back. */
async function loggedApp(options: { signedIn?: boolean } = {}): Promise<LoggedApp> {
  const { db } = database()
  const seeded = await seedExampleOrganization(db)
  const lines: Record<string, unknown>[] = []
  const config = testConfig()

  const app = await buildTestApp({
    config,
    database: db,
    logger: {
      ...(buildLoggerOptions(config) as Record<string, unknown>),
      level: 'info',
      stream: {
        write(chunk: string) {
          lines.push(JSON.parse(chunk) as Record<string, unknown>)
        },
      },
    },
    ...(options.signedIn === false ? {} : { memberResolver: async () => seeded.member }),
  })

  return {
    app,
    seeded,
    lines,
    linesFor: (message) => lines.filter((line) => line.msg === message),
  }
}

describe('the request completion line', () => {
  it('carries the request id, the member, the matched route, the status, and the duration', async () => {
    const { app, lines, linesFor } = await loggedApp()

    const response = await app.inject({ method: 'GET', url: '/handbook' })
    expect(response.statusCode).toBe(302)

    const [completed] = linesFor('request completed')
    expect(completionOf(completed)).toMatchObject({
      requestId: response.headers['x-request-id'],
      method: 'GET',
      route: '/*',
      statusCode: 302,
      memberId: '1',
      organizationId: RESOLVER_ORGANIZATION,
    })
    expect(typeof completionOf(completed).durationMs).toBe('number')
    // The id is on the line itself as well, which is what ties every line of one request together.
    expect(completed?.reqId).toBe(response.headers['x-request-id'])
    expect(lines.every((line) => line.msg !== undefined)).toBe(true)

    await app.close()
  })

  it('names the matched route rather than the keyword that was typed', async () => {
    const { app, lines } = await loggedApp()

    await app.inject({ method: 'GET', url: '/quarterly-revenue-plan' })

    const completed = lines.filter((line) => line.msg === 'request completed')
    expect(completed).toHaveLength(1)
    expect(completionOf(completed[0]).route).toBe('/*')
    // The keyword belongs on the resolver's own line, never on the request line.
    expect(JSON.stringify(completed)).not.toContain('quarterly-revenue-plan')

    await app.close()
  })

  it('leaves the member fields off a request nobody is signed in for', async () => {
    const { app, linesFor } = await loggedApp({ signedIn: false })

    await app.inject({ method: 'GET', url: '/handbook' })

    const [completed] = linesFor('request completed')
    expect(completionOf(completed)).not.toHaveProperty('memberId')
    expect(completionOf(completed)).not.toHaveProperty('organizationId')

    await app.close()
  })

  it('never writes a cookie or an Authorization header into the stream', async () => {
    const { app, lines } = await loggedApp()

    await app.inject({
      method: 'GET',
      url: '/handbook',
      headers: {
        cookie: 'gl_session=super-secret-session-id',
        authorization: 'Bearer super-secret-token',
      },
    })

    const written = JSON.stringify(lines)
    expect(written).not.toContain('super-secret-session-id')
    expect(written).not.toContain('super-secret-token')

    await app.close()
  })
})

describe('the resolver lines', () => {
  it('records a hit with its namespace, keyword, outcome, and only the destination host', async () => {
    const { app, lines } = await loggedApp()

    await app.inject({ method: 'GET', url: '/handbook' })

    const [hit] = lines.filter((line) => line.msg === 'keyword resolved')
    expect(hit).toMatchObject({
      namespace: 'go',
      keyword: 'handbook',
      outcome: 'hit',
      destinationHost: 'wiki.acme.com',
    })
    // The path of the destination is the part that can carry a secret.
    expect(JSON.stringify(lines)).not.toContain('wiki.acme.com/handbook')

    await app.close()
  })

  it('records a miss with its namespace, keyword, and outcome', async () => {
    const { app, lines } = await loggedApp()

    await app.inject({ method: 'GET', url: '/not-a-keyword' })

    expect(lines.filter((line) => line.msg === 'keyword did not resolve')[0]).toMatchObject({
      namespace: 'go',
      keyword: 'not-a-keyword',
      outcome: 'miss',
    })

    await app.close()
  })

  it('records a destination that will not serialize by its host alone, never in full', async () => {
    const { app, seeded, lines } = await loggedApp()

    // A port outside the legal range: stored happily, refused by the URL parser (spec 04 §7).
    await insertLink(database().db, {
      organizationId: RESOLVER_ORGANIZATION,
      ownerId: Number(seeded.member.id),
      keyword: 'broken',
      destination: 'https://reports.acme.com:99999/board?token=EXTREMELY-SECRET',
    })

    const response = await app.inject({ method: 'GET', url: '/broken' })
    expect(response.statusCode).toBe(502)

    const [failure] = lines.filter(
      (line) => line.msg === 'a stored destination could not be serialized as a URL',
    )
    expect(failure).toMatchObject({
      namespace: 'go',
      keyword: 'broken',
      outcome: 'unserializable',
      destinationHost: 'reports.acme.com:99999',
      reason: 'destination_unserializable',
    })
    expect(JSON.stringify(lines)).not.toContain('EXTREMELY-SECRET')

    await app.close()
  })
})

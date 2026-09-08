// The worked examples of spec 04 §9 against a real database, in every combination of the two
// organization settings that change the answer: whether punctuation counts (spec 03 §2.2) and
// which resolution mode is in force (spec 04 §5).

import type { KeywordResolutionMode } from '@golinks/shared/settings'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp } from '../../src/testing/fixtures.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import { seedExampleOrganization } from './resolver-fixtures.ts'

const database = useTestDatabase()

/** The `Location` a request is expected to be answered with, per resolution mode. */
interface Expectation {
  standard: string
  /** Defaults to `standard`: most examples do not depend on the mode. */
  prefixFallback?: string
}

const HANDBOOK = 'https://wiki.acme.com/handbook'
const NOTES = 'https://docs.acme.com/notes'

/** Rows that answer the same way whatever the organization's punctuation rule is. */
const COMMON: ReadonlyArray<readonly [string, Expectation]> = [
  ['/handbook', { standard: HANDBOOK }],
  ['/Handbook', { standard: HANDBOOK }],
  ['/handbook/', { standard: HANDBOOK }],
  ['/jira/ACME-123', { standard: 'https://acme.atlassian.net/browse/ACME-123' }],
  ['/jira/a%20b', { standard: 'https://acme.atlassian.net/browse/a%20b' }],
  ['/gh/web/42', { standard: 'https://github.com/acme/web/issues/42' }],
  ['/gh/web', { standard: '/_/?keyword=gh%2Fweb' }],
  ['/jira', { standard: '/_/?keyword=jira', prefixFallback: 'https://acme.atlassian.net/browse/' }],
  [
    '/handbook/extra',
    { standard: '/_/?keyword=handbook%2Fextra', prefixFallback: `${HANDBOOK}/extra` },
  ],
  ['/eng/deploy', { standard: 'https://deploy.acme.com/' }],
  ['/eng/nothing', { standard: '/_/?keyword=nothing&namespace=eng' }],
  ['/eng', { standard: '/_/?keyword=eng' }],
  ['/nothing-here', { standard: '/_/?keyword=nothing-here' }],
  ['/jira/2026-roadmap', { standard: 'https://acme.atlassian.net/browse/2026-roadmap' }],
]

type Punctuation = 'sensitive' | 'insensitive'

/** Rows whose answer is the whole point of the punctuation rule. */
const BY_PUNCTUATION: Record<Punctuation, ReadonlyArray<readonly [string, Expectation]>> = {
  sensitive: [
    ['/meeting-notes', { standard: NOTES }],
    ['/meetingnotes', { standard: '/_/?keyword=meetingnotes' }],
    ['/MEETING_NOTES', { standard: '/_/?keyword=meeting_notes' }],
  ],
  insensitive: [
    ['/meeting-notes', { standard: NOTES }],
    ['/meetingnotes', { standard: NOTES }],
    ['/MEETING_NOTES', { standard: NOTES }],
  ],
}

const CONFIGURATIONS: ReadonlyArray<readonly [Punctuation, KeywordResolutionMode]> = [
  ['sensitive', 'standard'],
  ['sensitive', 'prefixFallback'],
  ['insensitive', 'standard'],
  ['insensitive', 'prefixFallback'],
]

describe.each(CONFIGURATIONS)('a %s organization in %s mode', (punctuation, resolutionMode) => {
  let app: GoLinksApp

  beforeAll(async () => {
    await resetDatabase()
    const { db } = database()
    const seeded = await seedExampleOrganization(db, {
      settings: {
        keywords: { punctuationSensitive: punctuation === 'sensitive', resolutionMode },
      },
    })
    app = await buildTestApp({ database: db, memberResolver: async () => seeded.member })
  })

  afterAll(async () => {
    await app.close()
  })

  const cases = [...COMMON, ...BY_PUNCTUATION[punctuation]]

  it.each(cases)('%s', async (path, expectation) => {
    const response = await app.inject({ method: 'GET', url: path })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(expectation[resolutionMode] ?? expectation.standard)
  })

  it('answers HEAD exactly as GET, without a body', async () => {
    const get = await app.inject({ method: 'GET', url: '/handbook' })
    const head = await app.inject({ method: 'HEAD', url: '/handbook' })

    expect(head.statusCode).toBe(get.statusCode)
    expect(head.headers.location).toBe(get.headers.location)
    expect(head.body).toBe('')
  })

  it('refuses any other method', async () => {
    const response = await app.inject({ method: 'POST', url: '/handbook' })

    expect(response.statusCode).toBe(405)
    expect(response.headers.allow).toBe('GET, HEAD')
  })

  it('carries the headers a resolver redirect must have', async () => {
    const response = await app.inject({ method: 'GET', url: '/handbook' })

    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.headers['referrer-policy']).toBe('no-referrer')
  })
})

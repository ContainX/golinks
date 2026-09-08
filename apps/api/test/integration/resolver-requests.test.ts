// What the resolver answers around the resolution itself, against a real database: the
// short-host bounce (spec 04 §2), the authentication gate (spec 04 §3), the header the URL
// parser produces (spec 04 §7), and the page shown when it cannot produce one.

import { beforeEach, describe, expect, it } from 'vitest'
import { buildTestApp, CANONICAL_ORIGIN } from '../../src/testing/fixtures.ts'
import type { CurrentMember, GoLinksApp } from '../../src/types.ts'
import { insertLink, insertOrganization, insertUser } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  type ExampleLink,
  OTHER_ORGANIZATION,
  seedExampleOrganization,
} from './resolver-fixtures.ts'

const database = useTestDatabase()

beforeEach(async () => {
  await resetDatabase()
})

async function signedIn(links?: readonly ExampleLink[]): Promise<GoLinksApp> {
  const { db } = database()
  const seeded = await seedExampleOrganization(db, links === undefined ? {} : { links })
  return buildTestApp({ database: db, memberResolver: async () => seeded.member })
}

describe('the short-host bounce', () => {
  it('sends a keyword typed on the short host to the canonical host', async () => {
    const app = await signedIn()

    const response = await app.inject({
      method: 'GET',
      url: '/jira/ACME-1?via=search',
      headers: { host: 'go' },
    })

    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe(`${CANONICAL_ORIGIN}/jira/ACME-1?via=search`)

    await app.close()
  })

  it('bounces the directory itself, so go/ lands on the web app', async () => {
    const app = await signedIn()

    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'go' } })

    expect(response.headers.location).toBe(`${CANONICAL_ORIGIN}/`)

    await app.close()
  })

  it('answers health probes on any host', async () => {
    const app = await signedIn()

    const response = await app.inject({
      method: 'GET',
      url: '/_/health/live',
      headers: { host: 'go' },
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })
})

describe('the authentication gate', () => {
  it('sends a member without a session to sign-in and back again', async () => {
    const { db } = database()
    const seeded = await seedExampleOrganization(db)
    let member: CurrentMember | null = null
    const app = await buildTestApp({ database: db, memberResolver: async () => member })

    const anonymous = await app.inject({ method: 'GET', url: '/handbook?via=ext' })
    expect(anonymous.statusCode).toBe(302)
    expect(anonymous.headers.location).toBe('/_/auth/login?redirectTo=%2Fhandbook%3Fvia%3Dext')

    // Signing in and following redirectTo lands on the destination.
    member = seeded.member
    const returned = await app.inject({ method: 'GET', url: '/handbook?via=ext' })
    expect(returned.headers.location).toBe('https://wiki.acme.com/handbook')

    await app.close()
  })

  it('never lets a redirectTo address another origin', async () => {
    const app = await buildTestApp({ database: database().db })

    const response = await app.inject({ method: 'GET', url: '//evil.test/handbook' })

    expect(response.headers.location).toBe('/_/auth/login?redirectTo=%2F')

    await app.close()
  })
})

describe('the Location header', () => {
  it('is ASCII for a unicode placeholder value', async () => {
    const app = await signedIn([{ keyword: 'docs/%s', destination: 'https://docs.acme.com/%s' }])

    const response = await app.inject({ method: 'GET', url: '/docs/caf%C3%A9' })

    expect(response.headers.location).toBe('https://docs.acme.com/caf%C3%A9')

    await app.close()
  })

  it('is ASCII for a unicode destination', async () => {
    const app = await signedIn([
      { keyword: 'handbuch', destination: 'https://wiki.acme.com/handbuch/übersicht' },
    ])

    const response = await app.inject({ method: 'GET', url: '/handbuch' })

    expect(response.headers.location).toBe('https://wiki.acme.com/handbuch/%C3%BCbersicht')

    await app.close()
  })

  it('carries the ASCII form of an internationalized host', async () => {
    const app = await signedIn([
      { keyword: 'buecher', destination: 'https://bücher.example/handbuch' },
    ])

    const response = await app.inject({ method: 'GET', url: '/buecher' })

    expect(response.headers.location).toBe('https://xn--bcher-kva.example/handbuch')

    await app.close()
  })

  it('percent-encodes a space a member typed into a placeholder', async () => {
    const app = await signedIn()

    const response = await app.inject({ method: 'GET', url: '/jira/a%20b' })

    expect(response.headers.location).toBe('https://acme.atlassian.net/browse/a%20b')

    await app.close()
  })
})

describe('a destination that can no longer be serialized', () => {
  it('answers 502 naming the link and its owner instead of redirecting to garbage', async () => {
    const app = await signedIn([{ keyword: 'broken', destination: 'https://%s' }])

    const response = await app.inject({ method: 'GET', url: '/broken' })

    expect(response.statusCode).toBe(502)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.body).toContain('go/broken')
    expect(response.body).toContain('ada@widgets.test')

    await app.close()
  })
})

describe('organization isolation', () => {
  it('does not resolve a keyword that belongs to another organization', async () => {
    const { db } = database()
    const seeded = await seedExampleOrganization(db)
    await insertOrganization(db, OTHER_ORGANIZATION)
    const stranger = await insertUser(db, {
      email: 'sam@gizmos.test',
      organizationId: OTHER_ORGANIZATION,
    })
    await insertLink(db, {
      organizationId: OTHER_ORGANIZATION,
      ownerId: stranger.id,
      keyword: 'secret',
      destination: 'https://gizmos.test/secret',
    })
    const app = await buildTestApp({ database: db, memberResolver: async () => seeded.member })

    const response = await app.inject({ method: 'GET', url: '/secret' })

    expect(response.headers.location).toBe('/_/?keyword=secret')

    await app.close()
  })

  it('resolves an unlisted link for every member of its organization', async () => {
    const { db } = database()
    const seeded = await seedExampleOrganization(db)
    await insertLink(db, {
      organizationId: seeded.member.organizationId,
      ownerId: Number(seeded.member.id),
      keyword: 'payroll',
      destination: 'https://payroll.acme.com',
      isUnlisted: true,
    })
    const app = await buildTestApp({ database: db, memberResolver: async () => seeded.member })

    const response = await app.inject({ method: 'GET', url: '/payroll' })

    expect(response.headers.location).toBe('https://payroll.acme.com/')

    await app.close()
  })
})

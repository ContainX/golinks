// The member seam: `request.member` is populated before any handler runs, and the resolver
// can be swapped by a plugin (the sign-in module) or by a test.

import { describe, expect, it } from 'vitest'
import { buildTestApp } from './testing/fixtures.ts'
import type { CurrentMember } from './types.ts'

const jane: CurrentMember = {
  id: '7',
  email: 'jane@widgets.test',
  organizationId: 'widgets.test',
  role: 'admin',
}

describe('request.member', () => {
  it('is null when nobody installs a resolver', async () => {
    const app = await buildTestApp({
      plugins: [
        (app) => {
          app.get('/_/whoami', async (request) => ({ member: request.member }))
        },
      ],
    })
    const response = await app.inject({ method: 'GET', url: '/_/whoami' })
    expect(response.json()).toEqual({ member: null })
    await app.close()
  })

  it('is populated by the resolver passed to buildApp', async () => {
    const app = await buildTestApp({
      memberResolver: async () => jane,
      plugins: [
        (app) => {
          app.get('/_/whoami', async (request) => ({ member: request.member }))
        },
      ],
    })
    const response = await app.inject({ method: 'GET', url: '/_/whoami' })
    expect(response.json()).toEqual({ member: jane })
    await app.close()
  })

  it('is populated by a resolver a plugin installs later', async () => {
    const app = await buildTestApp({
      plugins: [
        (app) => {
          app.setMemberResolver(async (request) =>
            request.headers['x-test-member'] === 'jane' ? jane : null,
          )
          app.get('/_/whoami', async (request) => ({ member: request.member }))
        },
      ],
    })
    const anonymous = await app.inject({ method: 'GET', url: '/_/whoami' })
    expect(anonymous.json()).toEqual({ member: null })
    const signedIn = await app.inject({
      method: 'GET',
      url: '/_/whoami',
      headers: { 'x-test-member': 'jane' },
    })
    expect(signedIn.json()).toEqual({ member: jane })
    await app.close()
  })
})

describe('app.db', () => {
  it('explains itself when no database was opened', async () => {
    const app = await buildTestApp()
    expect(() => app.db).toThrow(/database/i)
    await app.close()
  })
})

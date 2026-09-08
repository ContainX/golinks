// `GET /_/auth/providers` (spec 02 §2 step 1).

import { SignInOptionsSchema } from '@golinks/shared/api'
import type { OidcProvider } from '@golinks/shared/config'
import { describe, expect, it } from 'vitest'
import type { ProviderRegistry } from '../../src/auth/oidc/registry.ts'
import { useTestDatabase } from './harness.ts'
import { buildIdentityApp } from './sign-in.ts'

const database = useTestDatabase()

const okta: OidcProvider = {
  id: 'okta',
  label: 'Sign in with Okta',
  issuer: 'https://acme.okta.com',
  clientId: 'client',
  clientSecret: 'secret',
  scopes: ['openid', 'email', 'profile', 'groups'],
  adminGroups: ['GoLinks Admins'],
  iconUrl: 'https://static.acme.com/okta.svg',
}

function registryOf(providers: OidcProvider[]): ProviderRegistry {
  return { providers, get: () => undefined, only: () => undefined }
}

describe('GET /_/auth/providers', () => {
  it('lists the configured providers and whether test sign-in is on, without a session', async () => {
    const app = await buildIdentityApp({
      database: database().db,
      identity: { providerRegistry: registryOf([okta]) },
    })
    const response = await app.inject({ method: 'GET', url: '/_/auth/providers' })
    expect(response.statusCode).toBe(200)
    const body = SignInOptionsSchema.parse(response.json())
    expect(body).toEqual({
      providers: [
        { id: 'okta', label: 'Sign in with Okta', iconUrl: 'https://static.acme.com/okta.svg' },
      ],
      testSignIn: true,
    })
    expect(response.headers['cache-control']).toContain('max-age=60')
    await app.close()
  })

  it('answers with an empty list when nothing is configured', async () => {
    const app = await buildIdentityApp({
      database: database().db,
      identity: { providerRegistry: registryOf([]) },
    })
    const response = await app.inject({ method: 'GET', url: '/_/auth/providers' })
    expect(SignInOptionsSchema.parse(response.json()).providers).toEqual([])
    await app.close()
  })
})

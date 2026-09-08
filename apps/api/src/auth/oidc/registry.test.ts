import type { Configuration } from 'openid-client'
import { describe, expect, it } from 'vitest'
import { testConfig } from '../../testing/fixtures.ts'
import { allowsInsecureIssuer, createProviderRegistry } from './registry.ts'

/** Stands in for a discovered configuration; nothing here calls into the library. */
const DISCOVERED = { serverMetadata: () => ({}) } as unknown as Configuration

function providersJson(...ids: string[]): string {
  return JSON.stringify(
    ids.map((id) => ({
      id,
      issuer: `https://${id}.example.com`,
      clientId: 'golinks',
      clientSecret: 'secret',
    })),
  )
}

describe('the provider registry (spec 02 §1)', () => {
  it('registers the provider the single-provider variables describe', () => {
    const registry = createProviderRegistry(testConfig())

    expect(registry.providers.map((provider) => provider.id)).toEqual(['oidc'])
    expect(registry.get('oidc')?.provider.issuer).toBe('https://acme.okta.com')
    expect(registry.get('entra')).toBeUndefined()
  })

  it('registers every provider named in the JSON list', () => {
    const registry = createProviderRegistry(
      testConfig({ OIDC_PROVIDERS_JSON: providersJson('okta', 'entra') }),
    )

    expect(registry.providers.map((provider) => provider.id)).toEqual(['okta', 'entra'])
  })

  it('names the only provider, which is what the sign-in shortcut asks for', () => {
    const single = createProviderRegistry(testConfig())
    expect(single.only()?.provider.id).toBe('oidc')

    const several = createProviderRegistry(
      testConfig({ OIDC_PROVIDERS_JSON: providersJson('okta', 'entra') }),
    )
    expect(several.only()).toBeUndefined()

    const none = createProviderRegistry(
      testConfig({
        OIDC_ISSUER: '',
        OIDC_CLIENT_ID: '',
        OIDC_CLIENT_SECRET: '',
        AUTH_TEST_MODE: 'true',
        AUTH_TEST_SECRET: 'a-secret-for-the-test-sign-in',
      }),
    )
    expect(none.only()).toBeUndefined()
    expect(none.providers).toHaveLength(0)
  })

  it('discovers a provider once and remembers what it found', async () => {
    let discoveries = 0
    const registry = createProviderRegistry(testConfig(), {
      discover: async () => {
        discoveries += 1
        return DISCOVERED
      },
    })

    const entry = registry.get('oidc')
    await Promise.all([entry?.configuration(), entry?.configuration()])
    await entry?.configuration()

    expect(discoveries).toBe(1)
  })

  it('discovers again after a failure rather than serving it forever', async () => {
    let discoveries = 0
    const registry = createProviderRegistry(testConfig(), {
      discover: async () => {
        discoveries += 1
        if (discoveries === 1) throw new Error('the provider was unreachable')
        return DISCOVERED
      },
    })

    const entry = registry.get('oidc')
    await expect(entry?.configuration()).rejects.toThrow('the provider was unreachable')
    await expect(entry?.configuration()).resolves.toBe(DISCOVERED)
    expect(discoveries).toBe(2)
  })

  it('discovers again once the metadata has been forgotten', async () => {
    let discoveries = 0
    const registry = createProviderRegistry(testConfig(), {
      discover: async () => {
        discoveries += 1
        return DISCOVERED
      },
    })

    const entry = registry.get('oidc')
    await entry?.configuration()
    entry?.forget()
    await entry?.configuration()

    expect(discoveries).toBe(2)
  })

  it('never speaks plain http to a provider in production', () => {
    const development = testConfig({ NODE_ENV: 'development' })
    const production = testConfig({ NODE_ENV: 'production' })

    expect(allowsInsecureIssuer(new URL('http://127.0.0.1:9000'), development)).toBe(true)
    expect(allowsInsecureIssuer(new URL('https://acme.okta.com'), development)).toBe(false)
    expect(allowsInsecureIssuer(new URL('http://127.0.0.1:9000'), production)).toBe(false)
  })
})

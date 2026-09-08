import { describeConfig } from '@golinks/shared/config'
import { describe, expect, it } from 'vitest'
import { BASE_ENVIRONMENT, testConfig, testEnvironment } from '../testing/fixtures.ts'
import { ConfigurationError, loadConfig } from './load.ts'

function issuesOf(environment: Record<string, string | undefined>): string[] {
  try {
    loadConfig(environment)
  } catch (error) {
    if (error instanceof ConfigurationError) return error.issues
    throw error
  }
  throw new Error('expected the configuration to be refused')
}

describe('loadConfig', () => {
  it('applies the documented defaults', () => {
    const config = testConfig()

    expect(config.port).toBe(3000)
    expect(config.shortHost).toBe('go')
    expect(config.logLevel).toBe('info')
    expect(config.trustProxy).toBe(false)
    expect(config.session.maxAgeMs).toBe(30 * 86_400_000)
    expect(config.session.idleTimeoutMs).toBeUndefined()
    expect(config.transfers.tokenTtlMs).toBe(24 * 3_600_000)
    expect(config.suggestions.minSimilarity).toBe(0.3)
    expect(config.visits.retentionDays).toBe(365)
    expect(config.organizations.resolution).toBe('domain')
    expect(config.oidc.providers[0]?.scopes).toEqual(['openid', 'email', 'profile'])
    expect(config.oidc.providers[0]?.label).toBe('Sign in')
    expect(config.rateLimit).toMatchObject({
      apiPerWindow: 600,
      linkCreatePerWindow: 60,
      resolverPerWindow: 1200,
      windowMs: 60_000,
    })
  })

  it('parses durations in days, hours, minutes, and seconds', () => {
    const config = testConfig({
      SESSION_MAX_AGE: '30d',
      SESSION_IDLE_TIMEOUT: '12h',
      TRANSFER_TOKEN_TTL: '15m',
      RATE_LIMIT_WINDOW: '90s',
    })

    expect(config.session.maxAgeMs).toBe(2_592_000_000)
    expect(config.session.idleTimeoutMs).toBe(43_200_000)
    expect(config.transfers.tokenTtlMs).toBe(900_000)
    expect(config.rateLimit.windowMs).toBe(90_000)
  })

  it('rejects a duration without a unit', () => {
    expect(issuesOf(testEnvironment({ SESSION_MAX_AGE: '30' }))).toEqual([
      expect.stringContaining('SESSION_MAX_AGE'),
    ])
  })

  it('reads comma separated lists and the domain alias map', () => {
    const config = testConfig({
      ORG_ALLOWED_IDS: 'acme.com, Beta.example ',
      INITIAL_ADMIN_EMAILS: 'Ops@acme.com,,dev@acme.com',
      ORG_DOMAIN_ALIASES: 'acme.co.uk=acme.com,jane@gmail.com=acme.com',
      AUTH_TEST_DOMAINS: 'example.test',
    })

    expect(config.organizations.allowedIds).toEqual(['acme.com', 'beta.example'])
    expect(config.organizations.initialAdminEmails).toEqual(['ops@acme.com', 'dev@acme.com'])
    expect(config.organizations.domainAliases).toEqual({
      'acme.co.uk': 'acme.com',
      'jane@gmail.com': 'acme.com',
    })
    expect(config.authTest.domains).toEqual(['example.test'])
  })

  it('rejects an alias map that is not made of pairs', () => {
    expect(issuesOf(testEnvironment({ ORG_DOMAIN_ALIASES: 'acme.co.uk' }))).toEqual([
      expect.stringContaining('ORG_DOMAIN_ALIASES'),
    ])
  })

  it('reads multiple providers from OIDC_PROVIDERS_JSON, which wins over the single provider', () => {
    const config = testConfig({
      OIDC_PROVIDERS_JSON: JSON.stringify([
        {
          id: 'okta',
          label: 'Sign in with Okta',
          issuer: 'https://acme.okta.com',
          clientId: 'a',
          clientSecret: 'b',
          scopes: 'openid email profile groups',
          adminGroups: ['golinks-admins'],
        },
        {
          id: 'partner',
          issuer: 'https://partner.example',
          clientId: 'c',
          clientSecret: 'd',
        },
      ]),
    })

    expect(config.oidc.providers.map((provider) => provider.id)).toEqual(['okta', 'partner'])
    expect(config.oidc.providers[0]?.scopes).toEqual(['openid', 'email', 'profile', 'groups'])
    expect(config.oidc.providers[0]?.adminGroups).toEqual(['golinks-admins'])
    expect(config.oidc.providers[1]?.label).toBe('Sign in')
  })

  it('refuses malformed OIDC_PROVIDERS_JSON', () => {
    expect(issuesOf(testEnvironment({ OIDC_PROVIDERS_JSON: 'not json' }))).toEqual([
      expect.stringContaining('OIDC_PROVIDERS_JSON'),
    ])
  })

  it('refuses to start with test sign-in on in production', () => {
    const issues = issuesOf(
      testEnvironment({
        NODE_ENV: 'production',
        AUTH_TEST_MODE: 'true',
        AUTH_TEST_SECRET: 'test-secret',
      }),
    )

    expect(issues).toEqual([expect.stringContaining('AUTH_TEST_MODE')])
    expect(issues[0]).toContain('production')
  })

  it('refuses to start with no identity provider unless test sign-in is on', () => {
    const withoutProvider = {
      ...BASE_ENVIRONMENT,
      OIDC_ISSUER: undefined,
      OIDC_CLIENT_ID: undefined,
      OIDC_CLIENT_SECRET: undefined,
    }

    expect(issuesOf(withoutProvider)).toEqual([
      expect.stringContaining('no identity provider is configured'),
    ])

    const withTestMode = loadConfig({
      ...withoutProvider,
      AUTH_TEST_MODE: 'true',
      AUTH_TEST_SECRET: 'test-secret',
    })
    expect(withTestMode.oidc.providers).toEqual([])
    expect(withTestMode.authTest.enabled).toBe(true)
  })

  it('refuses a half-configured single provider', () => {
    expect(issuesOf({ ...BASE_ENVIRONMENT, OIDC_CLIENT_SECRET: undefined })).toEqual([
      expect.stringContaining('must be set together'),
    ])
  })

  it('refuses test sign-in without a secret', () => {
    expect(issuesOf(testEnvironment({ AUTH_TEST_MODE: 'true' }))).toEqual([
      expect.stringContaining('AUTH_TEST_SECRET'),
    ])
  })

  it('requires ORG_FIXED_ID when resolution is fixed', () => {
    expect(issuesOf(testEnvironment({ ORG_RESOLUTION: 'fixed' }))).toEqual([
      expect.stringContaining('ORG_FIXED_ID'),
    ])
    expect(
      testConfig({ ORG_RESOLUTION: 'fixed', ORG_FIXED_ID: 'Acme' }).organizations.fixedId,
    ).toBe('acme')
  })

  it('reports every missing required variable at once', () => {
    const issues = issuesOf({})

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('BASE_URL'),
        expect.stringContaining('DATABASE_URL'),
        expect.stringContaining('SESSION_SECRET'),
      ]),
    )
  })

  it('rejects a session secret shorter than 32 characters', () => {
    expect(issuesOf(testEnvironment({ SESSION_SECRET: 'too-short' }))).toEqual([
      expect.stringContaining('at least 32'),
    ])
  })

  it('rejects a BASE_URL that is not a bare origin', () => {
    expect(issuesOf(testEnvironment({ BASE_URL: 'https://links.example.com/app' }))).toEqual([
      expect.stringContaining('BASE_URL'),
    ])
  })

  it('marks the session cookie secure unless the canonical origin is plain-http loopback', () => {
    expect(testConfig().session.cookieSecure).toBe(true)
    expect(testConfig({ BASE_URL: 'http://localhost:3000' }).session.cookieSecure).toBe(false)
    expect(testConfig({ BASE_URL: 'http://links.example.com' }).session.cookieSecure).toBe(true)
  })

  it('describes the effective configuration without leaking secrets', () => {
    const described = describeConfig(testConfig({ REDIS_URL: 'redis://user:hunter2@redis:6379' }))
    const serialized = JSON.stringify(described)

    expect(serialized).not.toContain('session-secret-that-is-long-enough-to-pass')
    expect(serialized).not.toContain('provider-secret')
    expect(serialized).not.toContain('hunter2')
    expect(described.databaseUrl).toBe('postgres://golinks:[redacted]@localhost:5432/golinks')
    expect(described.redisUrl).toBe('redis://user:[redacted]@redis:6379')
  })
})

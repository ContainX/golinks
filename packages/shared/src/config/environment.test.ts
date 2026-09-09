import { describe, expect, it } from 'vitest'
import { type DeploymentConfig, environmentSchema, formatEnvironmentIssues } from './environment.ts'
import { describeConfig } from './redaction.ts'

/** The smallest environment spec 06 §1 accepts, so each test names only what it is about. */
const BASE_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  NODE_ENV: 'test',
  BASE_URL: 'https://links.example.com',
  DATABASE_URL: 'postgres://golinks:secret@localhost:5432/golinks',
  SESSION_SECRET: 'session-secret-that-is-long-enough-to-pass',
  OIDC_ISSUER: 'https://acme.okta.com',
  OIDC_CLIENT_ID: 'golinks-web',
  OIDC_CLIENT_SECRET: 'provider-secret',
})

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop'
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`

function parse(overrides: Record<string, string | undefined> = {}): DeploymentConfig {
  const result = environmentSchema.safeParse({ ...BASE_ENVIRONMENT, ...overrides })
  if (!result.success) {
    throw new Error(
      `expected a valid configuration:\n${formatEnvironmentIssues(result.error).join('\n')}`,
    )
  }
  return result.data
}

function issuesOf(overrides: Record<string, string | undefined>): string[] {
  const result = environmentSchema.safeParse({ ...BASE_ENVIRONMENT, ...overrides })
  if (result.success) throw new Error('expected the configuration to be refused')
  return formatEnvironmentIssues(result.error)
}

describe('EXTENSION_ORIGINS (spec 06 §1, spec 12 §3)', () => {
  it('is empty on a deployment that has no extension', () => {
    expect(parse().extensionOrigins).toEqual([])
    expect(parse({ EXTENSION_ORIGINS: '' }).extensionOrigins).toEqual([])
  })

  it('reads a comma-separated list', () => {
    const second = `chrome-extension://${'p'.repeat(32)}`

    expect(parse({ EXTENSION_ORIGINS: `${EXTENSION_ORIGIN},${second}` }).extensionOrigins).toEqual([
      EXTENSION_ORIGIN,
      second,
    ])
  })

  it('trims entries, drops blank ones, and keeps each origin once', () => {
    const config = parse({
      EXTENSION_ORIGINS: ` ${EXTENSION_ORIGIN} , , ${EXTENSION_ORIGIN} `,
    })

    expect(config.extensionOrigins).toEqual([EXTENSION_ORIGIN])
  })

  it('normalizes an entry to the form a browser sends', () => {
    const config = parse({
      EXTENSION_ORIGINS: `Chrome-Extension://${EXTENSION_ID.toUpperCase()}/`,
    })

    expect(config.extensionOrigins).toEqual([EXTENSION_ORIGIN])
  })

  it.each([
    ['an http origin', 'https://evil.example'],
    ['an id that is too short', `chrome-extension://${'a'.repeat(31)}`],
    ['an id outside a-p', `chrome-extension://${'z'.repeat(32)}`],
    ['an id with digits', `chrome-extension://${'1'.repeat(32)}`],
    ['an origin carrying a path', `${EXTENSION_ORIGIN}/popup.html`],
    ['a bare extension id', EXTENSION_ID],
    ['one bad entry among good ones', `${EXTENSION_ORIGIN},not-an-origin`],
  ])('refuses %s', (_label, value) => {
    expect(issuesOf({ EXTENSION_ORIGINS: value })).toEqual([
      expect.stringContaining('EXTENSION_ORIGINS'),
    ])
  })

  it('appears in the configuration the service logs at startup', () => {
    expect(describeConfig(parse({ EXTENSION_ORIGINS: EXTENSION_ORIGIN })).extensionOrigins).toEqual(
      [EXTENSION_ORIGIN],
    )
    expect(describeConfig(parse()).extensionOrigins).toEqual([])
  })
})

describe('CONFIG_DIR and SETTINGS_OVERRIDES_JSON (spec 06 §1, §6)', () => {
  it('are undefined on a deployment that configures nothing from the outside', () => {
    const config = parse()

    expect(config.configDir).toBeUndefined()
    expect(config.settingsOverridesJson).toBeUndefined()
  })

  it('are read as written, trimmed', () => {
    const config = parse({
      CONFIG_DIR: ' /app/config ',
      SETTINGS_OVERRIDES_JSON: ' {"readOnly":true} ',
    })

    expect(config.configDir).toBe('/app/config')
    expect(config.settingsOverridesJson).toBe('{"readOnly":true}')
  })

  it('treat an empty value as unset, so a blank variable is not a directory', () => {
    const config = parse({ CONFIG_DIR: '', SETTINGS_OVERRIDES_JSON: '   ' })

    expect(config.configDir).toBeUndefined()
    expect(config.settingsOverridesJson).toBeUndefined()
  })
})

import type { DeploymentConfig } from '@golinks/shared/config'
import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../errors.ts'
import { testConfig } from '../testing/fixtures.ts'
import { MAX_TEST_TOKEN_LIFETIME_MS, verifyTestLoginToken } from './test-login.ts'

const SECRET = 'test-sign-in-secret-that-is-long-enough'
const NOW = Date.parse('2026-09-07T12:00:00.000Z')

const config = (overrides: Record<string, string> = {}): DeploymentConfig =>
  testConfig({
    AUTH_TEST_MODE: 'true',
    AUTH_TEST_SECRET: SECRET,
    AUTH_TEST_DOMAINS: 'widgets.test,gizmos.test',
    ...overrides,
  })

interface MintOptions {
  email?: string
  groups?: unknown
  adminGroups?: unknown
  secret?: string
  expiresInMs?: number
}

async function mint(options: MintOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = { email: options.email ?? 'ada@widgets.test' }
  if (options.groups !== undefined) claims.groups = options.groups
  if (options.adminGroups !== undefined) claims.adminGroups = options.adminGroups

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(Math.floor(NOW / 1000))
    .setExpirationTime(Math.floor((NOW + (options.expiresInMs ?? 60_000)) / 1000))
    .sign(new TextEncoder().encode(options.secret ?? SECRET))
}

async function refusal(token: string, deployment = config()): Promise<ApiError> {
  try {
    await verifyTestLoginToken(token, deployment, () => NOW)
  } catch (error) {
    if (error instanceof ApiError) return error
    throw error
  }
  throw new Error('The token was accepted when it should not have been.')
}

describe('verifyTestLoginToken', () => {
  it('accepts a well-formed token and normalizes the address', async () => {
    const claims = await verifyTestLoginToken(
      await mint({ email: '  Ada@Widgets.TEST ' }),
      config(),
      () => NOW,
    )
    expect(claims).toEqual({ email: 'ada@widgets.test', groups: [], adminGroups: [] })
  })

  it('carries the groups the token asserts, however they were written', async () => {
    const asArray = await verifyTestLoginToken(
      await mint({ groups: ['eng', 'golinks-admins'], adminGroups: ['golinks-admins'] }),
      config(),
      () => NOW,
    )
    expect(asArray.groups).toEqual(['eng', 'golinks-admins'])
    expect(asArray.adminGroups).toEqual(['golinks-admins'])

    const asText = await verifyTestLoginToken(
      await mint({ groups: 'eng, golinks-admins' }),
      config(),
      () => NOW,
    )
    expect(asText.groups).toEqual(['eng', 'golinks-admins'])
  })

  it('refuses a token signed with another secret', async () => {
    const error = await refusal(await mint({ secret: 'a-completely-different-secret' }))
    expect(error.code).toBe('unauthenticated')
    expect(error.details).toEqual({ reason: 'token_invalid' })
  })

  it('refuses a token that has already expired', async () => {
    const error = await refusal(await mint({ expiresInMs: -1_000 }))
    expect(error.code).toBe('unauthenticated')
    expect(error.details).toEqual({ reason: 'token_expired' })
  })

  it('refuses a token that claims more than five minutes of life', async () => {
    const error = await refusal(await mint({ expiresInMs: MAX_TEST_TOKEN_LIFETIME_MS + 60_000 }))
    expect(error.details).toEqual({ reason: 'token_lifetime_too_long' })
  })

  it('accepts a token that expires exactly at the ceiling', async () => {
    const claims = await verifyTestLoginToken(
      await mint({ expiresInMs: MAX_TEST_TOKEN_LIFETIME_MS }),
      config(),
      () => NOW,
    )
    expect(claims.email).toBe('ada@widgets.test')
  })

  it('refuses an address outside AUTH_TEST_DOMAINS', async () => {
    const error = await refusal(await mint({ email: 'ada@elsewhere.test' }))
    expect(error.code).toBe('forbidden')
    expect(error.details).toEqual({ reason: 'domain_not_allowed' })
  })

  it('refuses a token carrying no address at all', async () => {
    const error = await refusal(await mint({ email: '' }))
    expect(error.details).toEqual({ reason: 'domain_not_allowed' })
  })

  it('refuses everything when no secret is configured', async () => {
    const withoutSecret = testConfig()
    const error = await refusal(await mint(), withoutSecret)
    expect(error.code).toBe('not_found')
  })
})

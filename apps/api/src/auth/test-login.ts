// Test sign-in (spec 02 §8).
//
// A way for an automated test to become a member without an identity provider. It exists only
// when AUTH_TEST_MODE is on with AUTH_TEST_SECRET set, and the configuration itself refuses to
// start with test mode on under NODE_ENV=production, so these routes cannot be reached by a
// deployment that serves real members.
//
// Everything past the token check is the ordinary sign-in path: the same organization
// resolution, upsert, role computation, and session as a real provider produces.

import type { DeploymentConfig } from '@golinks/shared/config'
import type { FastifyRequest } from 'fastify'
import { errors as joseErrors, jwtVerify } from 'jose'
import { z } from 'zod'
import { ApiError } from '../errors.ts'
import type { GoLinksApp } from '../types.ts'
import { SignInError } from './errors.ts'
import { sanitizeRedirectTo } from './redirect-to.ts'
import { completeSignIn } from './sign-in.ts'

/** Where the routes live. */
export const TEST_LOGIN_PATH = '/_/auth/test-login'

/** Spec 02 §8: a token may not claim to be usable for longer than five minutes. */
export const MAX_TEST_TOKEN_LIFETIME_MS = 5 * 60 * 1000

/** The provider slug a test sign-in is recorded under, so a session says where it came from. */
export const TEST_PROVIDER_ID = 'test'

const TestLoginBodySchema = z.strictObject({
  token: z.string().min(1, 'A token is required.'),
})

const TestLoginQuerySchema = z.object({
  token: z.string().min(1, 'A token is required.'),
  redirectTo: z.string().optional(),
})

/** What the token asserts. `groups` drives the admin mapping of spec 01 §2.3. */
export interface TestLoginClaims {
  email: string
  groups: string[]
  adminGroups: string[]
}

function unauthenticated(message: string, reason: string): ApiError {
  return new ApiError('unauthenticated', message, { details: { reason } })
}

/**
 * Verifies the HS256 token and returns what it asserts.
 *
 * The signature, the expiry, the five-minute ceiling, and the domain allowlist are all
 * refusals of the token rather than of the member, so none of them reach `completeSignIn`.
 */
export async function verifyTestLoginToken(
  token: string,
  config: DeploymentConfig,
  now: () => number = Date.now,
): Promise<TestLoginClaims> {
  const secret = config.authTest.secret
  if (secret === undefined) {
    throw new ApiError('not_found', 'Test sign-in is not enabled on this deployment.')
  }

  let claims: Record<string, unknown>
  try {
    const verified = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      requiredClaims: ['exp'],
      // The same clock the five-minute ceiling below is measured against.
      currentDate: new Date(now()),
    })
    claims = verified.payload as Record<string, unknown>
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw unauthenticated('The test sign-in token has expired.', 'token_expired')
    }
    throw unauthenticated('The test sign-in token is not valid.', 'token_invalid')
  }

  const expiresAt = typeof claims.exp === 'number' ? claims.exp * 1000 : 0
  if (expiresAt - now() > MAX_TEST_TOKEN_LIFETIME_MS) {
    throw unauthenticated(
      'A test sign-in token may not expire more than five minutes from now.',
      'token_lifetime_too_long',
    )
  }

  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : ''
  const domain = email.slice(email.lastIndexOf('@') + 1)
  if (email.length === 0 || domain.length === 0 || !config.authTest.domains.includes(domain)) {
    throw new ApiError('forbidden', 'That email domain is not allowed to sign in for tests.', {
      details: { reason: 'domain_not_allowed' },
    })
  }

  return {
    email,
    groups: readGroups(claims.groups),
    // A test token names its own admin groups, since there is no provider configuration to
    // read them from. Anything listed in `groups` and here makes the member an admin.
    adminGroups: readGroups(claims.adminGroups),
  }
}

function readGroups(value: unknown): string[] {
  if (typeof value === 'string') return value.split(',').map((group) => group.trim())
  if (!Array.isArray(value)) return []
  return value.filter((group): group is string => typeof group === 'string')
}

export interface TestLoginRouteOptions {
  /** Clock, so a suite that drives session lifetimes stamps the sign-in on its own timeline. */
  now?: () => number
}

/** Registers the two routes. Called only when test mode is on. */
export function registerTestLoginRoutes(
  app: GoLinksApp,
  options: TestLoginRouteOptions = {},
): void {
  const config = app.appConfig
  const now = options.now ?? Date.now

  async function signIn(request: FastifyRequest, token: string) {
    const claims = await verifyTestLoginToken(token, config, now)
    try {
      return await completeSignIn(
        request,
        {
          email: claims.email,
          providerId: TEST_PROVIDER_ID,
          groups: claims.groups,
          // A group named on the token is an admin group; the deployment's own admin groups
          // apply too, so a test can exercise either mapping.
          adminGroups: [...claims.adminGroups, ...adminGroupsOf(config)],
        },
        { now },
      )
    } catch (error) {
      if (error instanceof SignInError) throw error.toApiError()
      throw error
    }
  }

  app.route({
    method: 'POST',
    url: TEST_LOGIN_PATH,
    schema: { body: TestLoginBodySchema },
    handler: async (request, reply) => {
      await signIn(request, request.body.token)
      return reply.code(204).send()
    },
  })

  app.route({
    method: 'GET',
    url: TEST_LOGIN_PATH,
    schema: { querystring: TestLoginQuerySchema },
    handler: async (request, reply) => {
      await signIn(request, request.query.token)
      return reply
        .header('cache-control', 'no-store')
        .redirect(sanitizeRedirectTo(request.query.redirectTo), 302)
    },
  })
}

/** Every admin group the configured providers recognize (spec 02 §1). */
function adminGroupsOf(config: DeploymentConfig): string[] {
  return config.oidc.providers.flatMap((provider) => provider.adminGroups)
}

// The sign-in routes of spec 02 §2: `/_/auth/login`, `/_/auth/start/:providerId`, and
// `/_/auth/callback/:providerId`.
//
// The three of them are one conversation. `login` decides how a member signs in, `start` sends
// them to the provider with a signed record of the attempt, and `callback` turns what comes
// back into a session. Everything after the identity is known belongs to `completeSignIn`, so
// the callback's own job ends at "this is the address the provider vouched for".
//
// Nothing a provider says reaches the browser. Every refusal is one of the codes of spec 02
// §2.1 in a redirect to the sign-in route; the reason behind it is logged with the request id.

import type { DeploymentConfig } from '@golinks/shared/config'
import type { FastifyBaseLogger, FastifyReply } from 'fastify'
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  type Configuration,
  calculatePKCECodeChallenge,
  fetchUserInfo,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client'
import { z } from 'zod'
import { notFound } from '../../errors.ts'
import type { GoLinksApp } from '../../types.ts'
import { isSignInError, isSignInErrorCode, SignInError } from '../errors.ts'
import {
  DEFAULT_REDIRECT_TO,
  sanitizeRedirectTo,
  signInPageLocation,
  signInPathWithError,
} from '../redirect-to.ts'
import { completeSignIn } from '../sign-in.ts'
import { type Claims, identityFromClaims } from './claims.ts'
import { clearLoginAttempt, readLoginAttempt, writeLoginAttempt } from './login-cookie.ts'
import type { ProviderRegistry, RegisteredProvider } from './registry.ts'

/** Where a member is sent to be signed in (spec 02 §2 step 1). */
export const AUTH_LOGIN_PATH = '/_/auth/login'

/** Where the redirect to a provider is minted (spec 02 §2 step 2). */
export const AUTH_START_PATH = '/_/auth/start/:providerId'

/** Where a provider returns the member (spec 02 §2 step 3). */
export const AUTH_CALLBACK_PATH = '/_/auth/callback/:providerId'

/** A sign-in never survives in a cache: it is a step in one member's conversation. */
const NO_STORE = 'no-store'

/** Everything on this path answers with a redirect the browser follows immediately. */
const REDIRECT_STATUS = 302

/**
 * The redirect URI registered with the provider (spec 02 §1.1). It is built from BASE_URL
 * rather than from the request, so a proxy that rewrites the Host cannot move it.
 */
export function callbackUri(baseUrl: string, providerId: string): string {
  return `${baseUrl}/_/auth/callback/${encodeURIComponent(providerId)}`
}

/** `/_/auth/start/<id>`, carrying the path the member was trying to reach. */
export function startPath(providerId: string, redirectTo: string): string {
  const path = `/_/auth/start/${encodeURIComponent(providerId)}`
  if (redirectTo === DEFAULT_REDIRECT_TO) return path
  return `${path}?${new URLSearchParams({ redirectTo }).toString()}`
}

const LoginQuerySchema = z.object({
  redirectTo: z.string().optional(),
  error: z.string().optional(),
})

const ProviderParamsSchema = z.object({
  providerId: z.string(),
})

const StartQuerySchema = z.object({
  redirectTo: z.string().optional(),
})

/** What a provider may put on the callback. Anything else it adds is ignored. */
const CallbackQuerySchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
})

function sendRedirect(reply: FastifyReply, location: string): FastifyReply {
  return reply.header('cache-control', NO_STORE).redirect(location, REDIRECT_STATUS)
}

export interface OidcRouteOptions {
  /** Clock handed to `completeSignIn`, so a suite stamps sign-ins on its own timeline. */
  now?: () => number
}

/**
 * Asks the userinfo endpoint who this is, or nothing when it cannot be reached.
 *
 * Spec 02 §2 step 5 makes the ID token the fallback for the address, so a userinfo endpoint
 * that is down or refuses the access token must not fail the sign-in on its own.
 */
async function fetchUserInfoOrNothing(
  configuration: Configuration,
  accessToken: string,
  subject: string,
  logger: FastifyBaseLogger,
  providerId: string,
): Promise<Claims | undefined> {
  try {
    return (await fetchUserInfo(configuration, accessToken, subject)) as unknown as Claims
  } catch (error) {
    logger.warn(
      { err: error, providerId },
      'the userinfo endpoint could not be read; falling back to the ID token claims',
    )
    return undefined
  }
}

/** Registers the three routes of spec 02 §2 on an instance. */
export function registerOidcRoutes(
  app: GoLinksApp,
  registry: ProviderRegistry,
  options: OidcRouteOptions = {},
): void {
  const config: DeploymentConfig = app.appConfig
  const now = options.now

  /** The provider a URL names, or a 404 when nothing is configured under that id. */
  function providerOr404(providerId: string): RegisteredProvider {
    const entry = registry.get(providerId)
    if (entry === undefined) {
      throw notFound(`No identity provider is configured with the id "${providerId}".`)
    }
    return entry
  }

  app.route({
    method: 'GET',
    url: AUTH_LOGIN_PATH,
    schema: { querystring: LoginQuerySchema },
    handler: async (request, reply) => {
      const redirectTo = sanitizeRedirectTo(request.query.redirectTo)

      // Already signed in: nothing to do but send them where they were going.
      if (request.member !== null) return sendRedirect(reply, redirectTo)

      // Only the codes the sign-in page has a message for are carried; anything else would
      // leave a member looking at a page that cannot explain itself.
      const error = isSignInErrorCode(request.query.error) ? request.query.error : undefined

      const only = registry.only()
      if (only !== undefined && error === undefined) {
        return sendRedirect(reply, startPath(only.provider.id, redirectTo))
      }

      return sendRedirect(reply, signInPageLocation({ redirectTo, error }))
    },
  })

  app.route({
    method: 'GET',
    url: AUTH_START_PATH,
    schema: { params: ProviderParamsSchema, querystring: StartQuerySchema },
    handler: async (request, reply) => {
      const entry = providerOr404(request.params.providerId)
      const provider = entry.provider
      const redirectTo = sanitizeRedirectTo(request.query.redirectTo)

      try {
        const configuration = await entry.configuration()

        const state = randomState()
        const nonce = randomNonce()
        const codeVerifier = randomPKCECodeVerifier()
        const codeChallenge = await calculatePKCECodeChallenge(codeVerifier)

        const authorizationUrl = buildAuthorizationUrl(configuration, {
          redirect_uri: callbackUri(config.baseUrl, provider.id),
          response_type: 'code',
          scope: provider.scopes.join(' '),
          state,
          nonce,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        })

        writeLoginAttempt(reply, config, {
          providerId: provider.id,
          state,
          nonce,
          codeVerifier,
          redirectTo,
        })

        return sendRedirect(reply, authorizationUrl.href)
      } catch (error) {
        // Metadata that cannot be used is metadata worth fetching again next time.
        entry.forget()
        request.log.error(
          { err: error, providerId: provider.id },
          'the sign-in could not be started with the identity provider',
        )
        return sendRedirect(reply, signInPathWithError('provider_error', redirectTo))
      }
    },
  })

  app.route({
    method: 'GET',
    url: AUTH_CALLBACK_PATH,
    schema: { params: ProviderParamsSchema, querystring: CallbackQuerySchema },
    handler: async (request, reply) => {
      const entry = providerOr404(request.params.providerId)
      const provider = entry.provider
      const attempt = readLoginAttempt(request)
      const redirectTo = attempt?.redirectTo ?? DEFAULT_REDIRECT_TO

      // The attempt is spent either way: a callback is only ever answered once.
      clearLoginAttempt(reply, config)

      try {
        // Spec 02 §2 step 3: no attempt, an attempt for another provider, or a `state` that
        // does not match is the same refusal. The browser is told no more than that.
        if (attempt === undefined || attempt.providerId !== provider.id) {
          throw new SignInError('login_state_mismatch', {
            message: 'The callback carried no usable sign-in attempt.',
          })
        }
        if (request.query.state !== attempt.state) {
          throw new SignInError('login_state_mismatch', {
            message: 'The state parameter does not match the sign-in attempt.',
          })
        }

        // A member who declined consent arrives here, as does any other provider-side refusal.
        if (request.query.error !== undefined) {
          throw new SignInError('provider_error', {
            message: `The identity provider refused the sign-in: ${request.query.error}`,
          })
        }

        const configuration = await entry.configuration()
        const tokens = await authorizationCodeGrant(
          configuration,
          new URL(request.url, config.baseUrl),
          {
            pkceCodeVerifier: attempt.codeVerifier,
            expectedState: attempt.state,
            // The library checks the issuer, the audience, the signature against the
            // discovered JWKS, the expiry, and this nonce (spec 02 §2 step 4).
            expectedNonce: attempt.nonce,
            idTokenExpected: true,
          },
        )

        const idTokenClaims = tokens.claims() as Claims | undefined
        const subject = typeof idTokenClaims?.sub === 'string' ? idTokenClaims.sub : undefined
        if (subject === undefined) {
          throw new SignInError('provider_error', {
            message: 'The identity provider returned no usable ID token.',
          })
        }

        const userInfo = await fetchUserInfoOrNothing(
          configuration,
          tokens.access_token,
          subject,
          request.log,
          provider.id,
        )
        const identity = identityFromClaims(userInfo, idTokenClaims)

        const outcome = await completeSignIn(
          request,
          {
            email: identity.email,
            providerId: provider.id,
            groups: identity.groups,
            adminGroups: provider.adminGroups,
            emailVerified: identity.emailVerified,
            ...(tokens.id_token === undefined ? {} : { idToken: tokens.id_token }),
          },
          { ...(now === undefined ? {} : { now }) },
        )

        request.log.info(
          {
            providerId: provider.id,
            userId: outcome.member.id,
            emailSource: identity.emailSource,
            groupsSource: identity.groupsSource,
            isFirstSignIn: outcome.isFirstSignIn,
            roleSource: outcome.roleSource,
          },
          'a member signed in through their identity provider',
        )

        return sendRedirect(reply, redirectTo)
      } catch (error) {
        const code = isSignInError(error) ? error.code : 'provider_error'
        // A failure that did not come from the member's own identity may well be stale
        // metadata, so the discovery document is fetched again on the next attempt.
        if (!isSignInError(error)) entry.forget()

        request.log.warn(
          {
            err: error,
            providerId: provider.id,
            reason: code,
            ...(request.query.error === undefined
              ? {}
              : {
                  providerError: request.query.error,
                  providerErrorDescription: request.query.error_description,
                }),
          },
          'a sign-in attempt was refused',
        )

        return sendRedirect(reply, signInPathWithError(code, redirectTo))
      }
    },
  })
}

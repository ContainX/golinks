// Sign-out (spec 02 §4).
//
// The session is destroyed server-side and the cookie is cleared, so the browser leaves with
// nothing to present again. Where the member lands afterwards depends on the deployment: the
// web app's signed-out page normally, or the provider's end-session endpoint when
// OIDC_LOGOUT_AT_IDP is on and the provider advertises one, which is the only way to end the
// session the member also holds at the provider.
//
// `POST` is the form the web app uses; `GET` exists for a plain link and is held to the same
// Origin check (spec 02 §6), which `security/origin-check.ts` applies to both.

import type { DeploymentConfig } from '@golinks/shared/config'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { buildEndSessionUrl } from 'openid-client'
import type { GoLinksApp } from '../types.ts'
import { sessionOf } from './member-resolver.ts'
import type { ProviderRegistry } from './oidc/registry.ts'
import { SIGN_IN_PAGE_PATH } from './redirect-to.ts'

/** Where sign-out lives (spec 02 §4). */
export const SIGN_OUT_PATH = '/_/auth/logout'

/** The page a member lands on once their session is gone (spec 02 §4). */
export const SIGNED_OUT_PATH = `${SIGN_IN_PAGE_PATH}?signedOut=1`

/** What the session held that sign-out needs after it has been destroyed. */
interface EndedSession {
  providerId: string | undefined
  idToken: string | undefined
}

/** Destroys the session, whatever the store has to say about it. */
async function endSession(request: FastifyRequest): Promise<EndedSession> {
  const session = sessionOf(request)
  if (session === null) return { providerId: undefined, idToken: undefined }

  const ended: EndedSession = {
    providerId: session.get('providerId'),
    idToken: session.get('idToken'),
  }

  try {
    await session.destroy()
  } catch (error) {
    // The cookie is cleared either way, so a store that is briefly unreachable cannot keep a
    // member signed in; the orphaned record expires on its own.
    request.log.warn({ err: error }, 'the session could not be destroyed on sign-out')
  }

  request.member = null
  return ended
}

/**
 * The provider's end-session URL, or undefined when this sign-out stays local.
 *
 * Three things have to line up: the deployment asked for it, the session kept an ID token to
 * present as the hint, and the provider says it has an end-session endpoint. Anything else,
 * including a provider that cannot be reached, falls back to the local page.
 */
async function endSessionUrl(
  request: FastifyRequest,
  config: DeploymentConfig,
  registry: ProviderRegistry | undefined,
  ended: EndedSession,
): Promise<string | undefined> {
  if (!config.oidc.logoutAtIdp) return undefined
  if (ended.providerId === undefined || ended.idToken === undefined) return undefined

  const entry = registry?.get(ended.providerId)
  if (entry === undefined) return undefined

  try {
    const configuration = await entry.configuration()
    if (configuration.serverMetadata().end_session_endpoint === undefined) return undefined

    return buildEndSessionUrl(configuration, {
      id_token_hint: ended.idToken,
      post_logout_redirect_uri: `${config.baseUrl}/`,
    }).href
  } catch (error) {
    entry.forget()
    request.log.warn(
      { err: error, providerId: ended.providerId },
      'the identity provider could not be asked to end its own session',
    )
    return undefined
  }
}

/** Registers `POST /_/auth/logout` and `GET /_/auth/logout`. */
export function registerSignOutRoutes(app: GoLinksApp, registry?: ProviderRegistry): void {
  const config = app.appConfig

  async function signOut(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const ended = await endSession(request)
    reply.clearCookie(config.session.cookieName, { path: '/' })

    const location = (await endSessionUrl(request, config, registry, ended)) ?? SIGNED_OUT_PATH
    return reply.header('cache-control', 'no-store').redirect(location, 302)
  }

  // The web app signs out by submitting a form, so the POST arrives with an empty
  // urlencoded body (spec 02 §4, §6). The route reads nothing from a body, so the parser only
  // has to accept and drop one. It is registered on the instance (a scoped plugin would mark
  // the instance started before the entry point finishes wiring it); the API's JSON-only rule
  // is enforced in the request hook before any body is parsed, so it is unaffected.
  for (const contentType of FORM_CONTENT_TYPES) {
    if (!app.hasContentTypeParser(contentType)) {
      app.addContentTypeParser(
        contentType,
        { parseAs: 'string', bodyLimit: FORM_BODY_LIMIT_BYTES },
        (_request, _body, done) => done(null, undefined),
      )
    }
  }
  for (const method of ['POST', 'GET'] as const) {
    // No HEAD alongside the GET: it would be a way to destroy a session that the Origin check
    // of spec 02 §6 does not cover, and nothing has a use for the headers of a sign-out.
    app.route({ method, url: SIGN_OUT_PATH, exposeHeadRoute: false, handler: signOut })
  }
}

/** What an HTML form posts, with or without files; a sign-out form carries no fields. */
export const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data']
export const FORM_BODY_LIMIT_BYTES = 1024

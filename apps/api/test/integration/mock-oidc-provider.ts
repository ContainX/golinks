// An OpenID Connect provider, in this process, for the contract tests of spec 10 §2.
//
// The sign-in flow of spec 02 §2 is a conversation between three parties, and the only way to
// prove the service holds up its end is to have the other two answer for real: a provider that
// signs its own ID tokens and checks what it is sent, and a browser that carries cookies from
// one hop to the next.
//
// The provider is a plain HTTP server on an ephemeral port serving the five endpoints the flow
// touches plus the discovery document that advertises them. It checks what a provider checks —
// the client credentials, the PKCE verifier, the redirect URI — and refuses when they do not
// hold, so a service that skipped any of them fails the suite. What it says about the member
// is `behavior`, which a test rewrites between attempts to produce the claim combinations of
// spec 02 §2 steps 5 to 7.
//
// The browser is `createCookieJar` and `driveSignIn`: `app.inject` for the hops the service
// answers, a real request for the hops the provider answers, and a cookie jar in between.

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import type { GoLinksApp } from '../../src/types.ts'

/** What the provider says about the member, and how it behaves while saying it. */
export interface MockProviderBehavior {
  /** The `sub` claim, stable across the ID token and userinfo. */
  subject: string
  /** Claims merged into every ID token: `email`, `email_verified`, `groups`, anything else. */
  idTokenClaims: Record<string, unknown>
  /** What `/userinfo` answers with, or `null` to make the endpoint fail. */
  userInfoClaims: Record<string, unknown> | null
  /** The status `/userinfo` fails with when it has nothing to say. */
  userInfoStatus: number
  /** When set, `/authorize` sends the browser back with this error instead of a code. */
  authorizeError: string | null
  /** Replaces the `nonce` echoed into the ID token, which a correct client refuses. */
  nonceOverride: string | null
}

export interface MockOidcProviderOptions {
  clientId?: string
  clientSecret?: string
  /** False leaves `end_session_endpoint` out of the discovery document (spec 02 §4). */
  advertisesEndSession?: boolean
  behavior?: Partial<MockProviderBehavior>
}

export interface MockOidcProvider {
  /** The issuer identifier, which is also the base of every endpoint. */
  issuer: string
  clientId: string
  clientSecret: string
  /** What the provider says about the member; read after a flow, rewritten with `configure`. */
  behavior: MockProviderBehavior
  /** Puts the behavior back to its defaults and applies the patch, for the next attempt. */
  configure(patch?: Partial<MockProviderBehavior>): void
  /** Every `/authorize` request, in order. */
  authorizeRequests: URLSearchParams[]
  /** Every `/token` request body, in order. */
  tokenRequests: Record<string, string>[]
  /** Every `/end-session` request, in order (spec 02 §4). */
  endSessionRequests: URLSearchParams[]
  /** The most recent authorization request, which is what the start route is judged by. */
  lastAuthorizeRequest(): URLSearchParams
  /** Forgets what has been recorded, so each test reads its own traffic. */
  clearRecordings(): void
  close(): Promise<void>
}

/** The default claims: a verified member of the widgets organization. */
const DEFAULT_BEHAVIOR: MockProviderBehavior = {
  subject: 'mock-subject',
  idTokenClaims: { email: 'someone@widgets.test' },
  userInfoClaims: { email: 'someone@widgets.test', email_verified: true },
  userInfoStatus: 500,
  authorizeError: null,
  nonceOverride: null,
}

/** One authorization the provider has issued a code for. */
interface PendingAuthorization {
  codeChallenge: string | undefined
  nonce: string | undefined
  redirectUri: string
  scope: string
  accessToken: string
}

function json(body: unknown): { body: string; contentType: string } {
  return { body: JSON.stringify(body), contentType: 'application/json' }
}

/** The client credentials a request presented, whichever way it presented them. */
function clientCredentials(
  authorization: string | undefined,
  form: Record<string, string>,
): { clientId: string; clientSecret: string } | undefined {
  if (authorization?.toLowerCase().startsWith('basic ') === true) {
    const decoded = Buffer.from(authorization.slice('basic '.length), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator === -1) return undefined
    return {
      clientId: decodeURIComponent(decoded.slice(0, separator)),
      clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
    }
  }
  const clientId = form.client_id
  const clientSecret = form.client_secret
  if (clientId === undefined || clientSecret === undefined) return undefined
  return { clientId, clientSecret }
}

function formToRecord(body: string): Record<string, string> {
  const record: Record<string, string> = {}
  for (const [key, value] of new URLSearchParams(body)) record[key] = value
  return record
}

async function readBody(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

/** Starts the provider and waits until it is listening. */
export async function startMockOidcProvider(
  options: MockOidcProviderOptions = {},
): Promise<MockOidcProvider> {
  const clientId = options.clientId ?? 'golinks-test-client'
  const clientSecret = options.clientSecret ?? 'golinks-test-secret'
  const advertisesEndSession = options.advertisesEndSession ?? true

  const baseline: MockProviderBehavior = { ...DEFAULT_BEHAVIOR, ...options.behavior }
  const behavior: MockProviderBehavior = { ...baseline }

  // A key pair per provider, so nothing a test signs is reusable anywhere else.
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  const keyId = randomBytes(8).toString('hex')
  const publicJwk = { ...(await exportJWK(publicKey)), kid: keyId, alg: 'RS256', use: 'sig' }

  const authorizations = new Map<string, PendingAuthorization>()
  const accessTokens = new Map<string, PendingAuthorization>()

  const provider: MockOidcProvider = {
    issuer: '',
    clientId,
    clientSecret,
    behavior,
    configure(patch = {}) {
      Object.assign(behavior, baseline, patch)
    },
    authorizeRequests: [],
    tokenRequests: [],
    endSessionRequests: [],
    lastAuthorizeRequest() {
      const last = provider.authorizeRequests.at(-1)
      if (last === undefined) throw new Error('The provider was never asked to authorize.')
      return last
    },
    clearRecordings() {
      provider.authorizeRequests.length = 0
      provider.tokenRequests.length = 0
      provider.endSessionRequests.length = 0
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    },
  }

  async function issueIdToken(authorization: PendingAuthorization): Promise<string> {
    const nonce = behavior.nonceOverride ?? authorization.nonce
    const claims: Record<string, unknown> = {
      ...behavior.idTokenClaims,
      ...(nonce === undefined ? {} : { nonce }),
    }
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: keyId, typ: 'JWT' })
      .setIssuer(provider.issuer)
      .setSubject(behavior.subject)
      .setAudience(clientId)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
  }

  const server = createServer((request, response) => {
    const send = (
      status: number,
      payload: { body: string; contentType: string } | undefined,
      headers: Record<string, string> = {},
    ): void => {
      response.writeHead(status, {
        ...(payload === undefined ? {} : { 'content-type': payload.contentType }),
        'cache-control': 'no-store',
        ...headers,
      })
      response.end(payload?.body)
    }

    void (async () => {
      const url = new URL(request.url ?? '/', provider.issuer)

      switch (url.pathname) {
        case '/.well-known/openid-configuration': {
          send(
            200,
            json({
              issuer: provider.issuer,
              authorization_endpoint: `${provider.issuer}/authorize`,
              token_endpoint: `${provider.issuer}/token`,
              userinfo_endpoint: `${provider.issuer}/userinfo`,
              jwks_uri: `${provider.issuer}/jwks`,
              ...(advertisesEndSession
                ? { end_session_endpoint: `${provider.issuer}/end-session` }
                : {}),
              response_types_supported: ['code'],
              grant_types_supported: ['authorization_code'],
              subject_types_supported: ['public'],
              id_token_signing_alg_values_supported: ['RS256'],
              scopes_supported: ['openid', 'email', 'profile', 'groups'],
              token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
              code_challenge_methods_supported: ['S256'],
              claims_supported: ['sub', 'email', 'email_verified', 'groups'],
            }),
          )
          return
        }

        case '/jwks': {
          send(200, json({ keys: [publicJwk] }))
          return
        }

        case '/authorize': {
          const parameters = new URLSearchParams(url.search)
          provider.authorizeRequests.push(parameters)

          const redirectUri = parameters.get('redirect_uri')
          if (redirectUri === null) {
            send(400, json({ error: 'invalid_request', error_description: 'no redirect_uri' }))
            return
          }

          const back = new URL(redirectUri)
          const state = parameters.get('state')
          if (state !== null) back.searchParams.set('state', state)

          if (behavior.authorizeError !== null) {
            // What a provider sends when the member declines consent (spec 02 §2 step 4).
            back.searchParams.set('error', behavior.authorizeError)
            back.searchParams.set('error_description', 'the member declined')
            send(302, undefined, { location: back.href })
            return
          }

          const code = randomBytes(16).toString('base64url')
          authorizations.set(code, {
            codeChallenge: parameters.get('code_challenge') ?? undefined,
            nonce: parameters.get('nonce') ?? undefined,
            redirectUri,
            scope: parameters.get('scope') ?? 'openid',
            accessToken: randomBytes(24).toString('base64url'),
          })
          back.searchParams.set('code', code)
          send(302, undefined, { location: back.href })
          return
        }

        case '/token': {
          if (request.method !== 'POST') {
            send(405, json({ error: 'invalid_request', error_description: 'POST only' }))
            return
          }
          const form = formToRecord(await readBody(request))
          provider.tokenRequests.push(form)

          const credentials = clientCredentials(request.headers.authorization, form)
          if (credentials?.clientId !== clientId || credentials.clientSecret !== clientSecret) {
            send(401, json({ error: 'invalid_client', error_description: 'bad credentials' }))
            return
          }
          if (form.grant_type !== 'authorization_code') {
            send(400, json({ error: 'unsupported_grant_type' }))
            return
          }

          const code = form.code ?? ''
          const authorization = authorizations.get(code)
          if (authorization === undefined) {
            send(400, json({ error: 'invalid_grant', error_description: 'unknown code' }))
            return
          }
          // A code is good once, which is what makes a replayed callback useless.
          authorizations.delete(code)

          if (form.redirect_uri !== authorization.redirectUri) {
            send(400, json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }))
            return
          }

          const verifier = form.code_verifier
          const challenge =
            verifier === undefined
              ? undefined
              : createHash('sha256').update(verifier).digest('base64url')
          if (authorization.codeChallenge !== challenge) {
            send(400, json({ error: 'invalid_grant', error_description: 'PKCE check failed' }))
            return
          }

          accessTokens.set(authorization.accessToken, authorization)
          send(
            200,
            json({
              access_token: authorization.accessToken,
              token_type: 'Bearer',
              expires_in: 300,
              scope: authorization.scope,
              id_token: await issueIdToken(authorization),
            }),
          )
          return
        }

        case '/userinfo': {
          const header = request.headers.authorization ?? ''
          const token = header.toLowerCase().startsWith('bearer ')
            ? header.slice('bearer '.length)
            : ''
          if (!accessTokens.has(token)) {
            send(401, json({ error: 'invalid_token' }), {
              'www-authenticate': 'Bearer error="invalid_token"',
            })
            return
          }
          if (behavior.userInfoClaims === null) {
            send(behavior.userInfoStatus, json({ error: 'server_error' }))
            return
          }
          send(200, json({ sub: behavior.subject, ...behavior.userInfoClaims }))
          return
        }

        case '/end-session': {
          const parameters = new URLSearchParams(url.search)
          provider.endSessionRequests.push(parameters)
          const back = parameters.get('post_logout_redirect_uri')
          if (back === null) {
            send(200, json({ signedOut: true }))
            return
          }
          send(302, undefined, { location: back })
          return
        }

        default: {
          send(404, json({ error: 'not_found' }))
        }
      }
    })().catch((error: unknown) => {
      if (response.headersSent) {
        response.end()
        return
      }
      send(500, json({ error: 'mock_provider_failure', message: String(error) }))
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  provider.issuer = `http://127.0.0.1:${address.port}`

  return provider
}

// --- the browser that drives the flow ---------------------------------------

/** The cookies a browser is holding between hops. */
export interface CookieJar {
  /** The `Cookie` header for the next request, or undefined when nothing is held. */
  header(): string | undefined
  /** Headers to spread into an injection: the cookie, when there is one. */
  headers(extra?: Record<string, string>): Record<string, string>
  /** Applies the `Set-Cookie` headers of a response, including the ones that clear. */
  accept(setCookie: string | string[] | undefined): void
  /** The value of one cookie, or undefined when it is not held. */
  get(name: string): string | undefined
  /** Every cookie name currently held. */
  names(): string[]
}

/** Whether a `Set-Cookie` header is telling the browser to forget the cookie. */
function clearsCookie(attributes: readonly string[]): boolean {
  for (const attribute of attributes) {
    const [name, value] = attribute.split('=', 2)
    const key = name?.trim().toLowerCase()
    if (key === 'max-age' && Number(value) <= 0) return true
    if (key === 'expires' && Date.parse(value ?? '') <= Date.now()) return true
  }
  return false
}

export function createCookieJar(): CookieJar {
  const cookies = new Map<string, string>()

  const header = (): string | undefined => {
    if (cookies.size === 0) return undefined
    return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ')
  }

  return {
    header,
    headers(extra = {}) {
      const cookie = header()
      return { ...(cookie === undefined ? {} : { cookie }), ...extra }
    },
    accept(setCookie) {
      const headers = Array.isArray(setCookie)
        ? setCookie
        : setCookie === undefined
          ? []
          : [setCookie]
      for (const header of headers) {
        const [pair, ...attributes] = header.split(';')
        const separator = pair?.indexOf('=') ?? -1
        if (pair === undefined || separator <= 0) continue
        const name = pair.slice(0, separator).trim()
        const value = pair.slice(separator + 1).trim()
        if (clearsCookie(attributes) || value.length === 0) cookies.delete(name)
        else cookies.set(name, value)
      }
    },
    get: (name) => cookies.get(name),
    names: () => [...cookies.keys()],
  }
}

/** One response in a flow, whoever answered it. */
export interface FlowHop {
  /** Where the request went. */
  url: string
  status: number
  /** The `Location` header, when the answer was a redirect. */
  location: string | undefined
  /** True when the provider answered rather than the service. */
  atProvider: boolean
}

export interface SignInFlowResult {
  /** Every hop, in order, which is what an assertion about the route to a page reads. */
  hops: FlowHop[]
  /** Where the browser was left, which is the last `Location` that was not followed. */
  location: string
  /** The cookies the browser ended up holding. */
  jar: CookieJar
}

export interface DriveSignInOptions {
  /** Where the flow starts. Defaults to `/_/auth/login`. */
  start?: string
  /** Cookies the browser already holds. */
  jar?: CookieJar
  /** Follows at most this many hops before giving up. */
  maxHops?: number
}

/** Asks the provider, for real, and returns where it sends the browser next. */
export async function requestAtProvider(url: string): Promise<FlowHop> {
  const response = await fetch(url, { redirect: 'manual' })
  // The body is not used, but leaving it unread keeps the socket busy.
  await response.arrayBuffer()
  return {
    url,
    status: response.status,
    location: response.headers.get('location') ?? undefined,
    atProvider: true,
  }
}

/**
 * Walks the sign-in flow the way a browser would.
 *
 * Only the hops that belong to the sign-in conversation are followed — the service's own
 * `/_/auth` routes and whatever the provider answers with. The first location outside them is
 * where the member has landed, and that is what the result reports.
 */
export async function driveSignIn(
  app: GoLinksApp,
  provider: MockOidcProvider,
  options: DriveSignInOptions = {},
): Promise<SignInFlowResult> {
  const jar = options.jar ?? createCookieJar()
  const maxHops = options.maxHops ?? 10
  const hops: FlowHop[] = []

  // The provider sends the browser back to an absolute callback URL; every hop the service
  // answers is injected, so those come back to a path on this instance.
  const toServicePath = (location: string): string => {
    const base = app.appConfig.baseUrl
    if (!location.startsWith(base)) return location
    const path = location.slice(base.length)
    return path.length === 0 ? '/' : path
  }

  const start = options.start ?? '/_/auth/login'
  let next: string | undefined = start
  // Where the browser has been left: the last location it was sent to, or the page that
  // answered when the flow ended with something other than a redirect.
  let landed = start

  for (let hop = 0; hop < maxHops && next !== undefined; hop += 1) {
    const current: string = next

    const answered = current.startsWith(provider.issuer)
      ? await requestAtProvider(current)
      : await injectHop(app, jar, current)
    hops.push(answered)

    if (answered.location === undefined) {
      landed = current
      break
    }

    landed = toServicePath(answered.location)
    // The conversation is over as soon as it leaves the sign-in routes and the provider.
    const followable = landed.startsWith('/_/auth/') || landed.startsWith(provider.issuer)
    next = followable ? landed : undefined
  }

  return { hops, location: landed, jar }
}

/** One hop the service answers, with the jar updated from whatever it set. */
async function injectHop(app: GoLinksApp, jar: CookieJar, url: string): Promise<FlowHop> {
  const response = await app.inject({ method: 'GET', url, headers: jar.headers() })
  jar.accept(response.headers['set-cookie'])
  const location = response.headers.location
  return {
    url,
    status: response.statusCode,
    location: typeof location === 'string' ? location : undefined,
    atProvider: false,
  }
}

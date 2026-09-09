// The application factory. Everything the service needs is passed in, so a test can build a
// fully wired instance without a database, a Redis, or an identity provider.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DeploymentConfig } from '@golinks/shared/config'
import { type DeploymentSettingsOverrides, NO_DEPLOYMENT_OVERRIDES } from '@golinks/shared/settings'
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { resolveAssetPaths } from './config/load.ts'
import { type Database, getDatabase } from './db/client.ts'
import { registerErrorHandling } from './error-handler.ts'
import { buildLoggerOptions, createRequestIdGenerator, REQUEST_ID_HEADER } from './logging.ts'
import { registerMetrics } from './metrics/plugin.ts'
import { registerOpenApi } from './openapi/plugin.ts'
import { brandingDirectoryOf } from './organizations/deployment-overrides.ts'
import {
  createOrganizationSettingsService,
  type OrganizationSettingsService,
} from './organizations/settings-service.ts'
import { registerShortHostBounce } from './resolver/bounce.ts'
import { registerApiRoutes } from './routes/api.ts'
import { registerHealthRoutes } from './routes/health.ts'
import { registerOpenSearchRoute } from './routes/opensearch.ts'
import { registerResolverRoutes } from './routes/resolver.ts'
import { registerStaticAssets } from './routes/static-assets.ts'
import { registerSecurityHeaders } from './security/headers.ts'
import { registerOriginCheck } from './security/origin-check.ts'
import {
  defaultRateLimitSubjectResolver,
  type RateLimitSubjectResolver,
  registerRateLimits,
} from './security/rate-limits.ts'
import { registerSessions, type SessionStore } from './security/session.ts'
import type { GoLinksApp, MemberResolver, ReadinessCheck } from './types.ts'

/** Request bodies are capped well below anything the API legitimately accepts (spec 09 §6). */
export const BODY_LIMIT_BYTES = 64 * 1024

export interface BuildAppOptions {
  config: DeploymentConfig
  /**
   * Dependencies `/_/health/ready` probes. More can be added later with
   * `app.addReadinessCheck`, which is how the database task registers Postgres.
   */
  readinessChecks?: readonly ReadinessCheck[]
  /** Overrides the logger; tests pass `false`. */
  logger?: FastifyServerOptions['logger']
  /**
   * The database handle. Defaults to the process-wide connection that `index.ts` opens; the
   * integration harness passes its own. Read lazily, so an app without a database still
   * boots for tests that never touch one.
   */
  database?: Database
  /** Overrides the settings service, which is otherwise built on `database`. */
  organizationSettings?: OrganizationSettingsService
  /**
   * The organization settings this deployment fixes (spec 06 §6). They reach every read
   * through the settings service built here when none is passed, and the app shell's first
   * paint either way.
   */
  settingsOverrides?: DeploymentSettingsOverrides
  /** How `request.member` is populated. Defaults to "nobody is signed in". */
  memberResolver?: MemberResolver
  /** Server-side session store. Defaults to the in-process store (spec 02 §3). */
  sessionStore?: SessionStore
  /** Overrides where the built web app is read from. `null` disables SPA hosting. */
  webDistPath?: string | null
  /** Overrides the directory holding favicon.ico and robots.txt. */
  publicPath?: string
  /**
   * Shared counter store for rate limits, normally an ioredis client. `null` forces the
   * in-process store even when REDIS_URL is set.
   */
  rateLimitStore?: unknown
  /**
   * Extra registrations that run after the security baseline and before the built-in routes,
   * so that their routes are protected and still lose to the resolver catch-all. The database
   * plugin and the API route modules attach themselves here.
   */
  plugins?: readonly ((app: GoLinksApp) => void | Promise<void>)[]
}

/**
 * Builds a ready-to-serve instance. The returned app has been booted, so calling
 * `app.inject()` or `app.listen()` is all that is left to do.
 */
export async function buildApp(options: BuildAppOptions): Promise<GoLinksApp> {
  const { config } = options

  const app = Fastify({
    // A trusted proxy is the immediate one only (spec 09 §7): hop 0 is the peer that opened
    // the connection, and nothing further down the chain is believed.
    trustProxy: config.trustProxy ? (_address: string, hop: number) => hop === 0 : false,
    bodyLimit: BODY_LIMIT_BYTES,
    // The id is chosen by us, never taken from an untrusted caller.
    requestIdHeader: false,
    genReqId: createRequestIdGenerator(config.trustProxy),
    logger: options.logger ?? buildLoggerOptions(config),
  })
    .setValidatorCompiler(validatorCompiler)
    .setSerializerCompiler(serializerCompiler)
    .withTypeProvider<ZodTypeProvider>()

  const settingsOverrides = options.settingsOverrides ?? NO_DEPLOYMENT_OVERRIDES
  const readinessChecks: ReadinessCheck[] = [...(options.readinessChecks ?? [])]
  let subjectResolver: RateLimitSubjectResolver = defaultRateLimitSubjectResolver

  app.decorate('appConfig', config)
  app.decorate('addReadinessCheck', (check: ReadinessCheck) => {
    readinessChecks.push(check)
  })
  app.decorate('readinessChecks', () => readinessChecks as readonly ReadinessCheck[])
  app.decorate('resolveRateLimitSubject', (request: FastifyRequest) => subjectResolver(request))
  app.decorate('setRateLimitSubjectResolver', (resolver: RateLimitSubjectResolver) => {
    subjectResolver = resolver
  })

  app.decorate('db', {
    getter: () => options.database ?? getDatabase(),
  })
  let settingsService = options.organizationSettings
  app.decorate('organizationSettings', {
    getter: () => {
      settingsService ??= createOrganizationSettingsService(app.db, {
        logger: app.log,
        overrides: settingsOverrides,
      })
      return settingsService
    },
  })

  let memberResolver: MemberResolver = options.memberResolver ?? (async () => null)
  app.decorateRequest('member', null)
  app.decorate('setMemberResolver', (resolver: MemberResolver) => {
    memberResolver = resolver
  })

  // Every response carries the request id clients quote when reporting a problem (spec 05 §1).
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id)
  })

  // Ahead of the session, and of every route: a request that arrived under another name is
  // sent to the canonical host before anything reads a cookie (spec 04 §2).
  registerShortHostBounce(app, config)

  registerSecurityHeaders(app, config)
  registerSessions(app, config, { store: options.sessionStore })

  // Counters live in Redis when one is configured so that a limit holds across replicas.
  const rateLimitStore =
    options.rateLimitStore === undefined
      ? await createRateLimitStore(app, config)
      : (options.rateLimitStore ?? undefined)
  app.decorate('rateLimits', registerRateLimits(app, config, { redis: rateLimitStore }))

  registerOriginCheck(app, config)
  registerErrorHandling(app)

  // Ahead of every route: the document generator collects routes through `onRoute`, so it has
  // to have loaded before the first one is declared (spec 05 §1).
  registerOpenApi(app)

  // Every plugin queued above has to be loaded before the first route is declared: Fastify
  // runs `onRoute` hooks as the route is declared, and that is how the rate limiter attaches
  // itself to a route.
  await app.after()

  // Runs after the session plugin above has loaded, so the resolver can read the session,
  // and before any route is declared, so every handler sees `request.member`.
  app.addHook('onRequest', async (request) => {
    request.member = await memberResolver(request)
  })

  // Instruments are always present so modules can record into them; the scrape endpoint and
  // the Node.js default collectors follow METRICS_ENABLED (spec 07 §3).
  registerMetrics(app, {
    exposeEndpoint: config.metrics.enabled,
    collectDefaults: config.metrics.enabled,
  })

  const assets = resolveAssetPaths(config)
  registerStaticAssets(app, {
    publicPath: options.publicPath ?? assets.publicPath,
    webDistPath: chooseWebDistPath(options, assets.webDistPath),
    brandingPath: brandingDirectoryOf(config),
    settingsOverrides,
  })

  for (const plugin of options.plugins ?? []) await plugin(app)

  registerHealthRoutes(app)
  registerOpenSearchRoute(app)
  registerApiRoutes(app)
  registerResolverRoutes(app)

  await app.ready()
  return app
}

/** An explicitly supplied directory still has to contain a built app to be usable. */
function chooseWebDistPath(
  options: BuildAppOptions,
  fallback: string | undefined,
): string | undefined {
  if (options.webDistPath === null) return undefined
  if (options.webDistPath === undefined) return fallback
  return existsSync(join(options.webDistPath, 'index.html')) ? options.webDistPath : undefined
}

/**
 * Opens the shared counter store when REDIS_URL is set. A Redis that cannot be reached must
 * not take the service down: the plugin falls back to counting in process memory, so the
 * client is created with a short leash and its errors are logged, not thrown.
 */
async function createRateLimitStore(
  app: GoLinksApp,
  config: DeploymentConfig,
): Promise<unknown | undefined> {
  if (config.redisUrl === undefined) return undefined

  const { Redis } = await import('ioredis')
  const client = new Redis(config.redisUrl, {
    connectTimeout: 500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  })
  client.on('error', (error: Error) => {
    app.log.warn({ err: error }, 'rate limit store unavailable, counting in process memory')
  })
  app.addHook('onClose', async () => {
    client.disconnect()
  })
  return client
}

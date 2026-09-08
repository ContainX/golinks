// Process entry point: read the environment, build the application, and serve.

import type { DeploymentConfig } from '@golinks/shared/config'
import { describeConfig } from '@golinks/shared/config'
import type { FastifyBaseLogger } from 'fastify'
import type { Redis } from 'ioredis'
import { buildApp } from './app.ts'
import { createIdentityPlugin } from './auth/plugin.ts'
import { createConfiguredSessionStore, type SessionRedisClient } from './auth/session-stores.ts'
import { ConfigurationError, loadConfig } from './config/load.ts'
import {
  checkDatabaseReady,
  closeDatabase,
  getDatabase,
  getSql,
  initializeDatabase,
} from './db/client.ts'
import { startBackgroundJobs } from './jobs/index.ts'
import {
  createRedisSettingsCache,
  type SettingsRedisClient,
  type SharedSettingsCache,
} from './organizations/settings-cache.ts'
import { createOrganizationSettingsService } from './organizations/settings-service.ts'
import type { ReadinessCheck } from './types.ts'

/**
 * Opens the session store's Redis connection when REDIS_URL is set (spec 02 §3).
 *
 * Sessions are not something to guess at, so unlike the rate limiter this client has no
 * in-process fallback: a Redis that cannot be reached makes the service unready, which is what
 * `/_/health/ready` is for.
 */
async function openSessionRedis(config: DeploymentConfig): Promise<Redis | undefined> {
  if (config.redisUrl === undefined) return undefined
  const { Redis: RedisClient } = await import('ioredis')
  return new RedisClient(config.redisUrl, { maxRetriesPerRequest: 3, lazyConnect: true })
}

/** The two levels the settings service and its shared cache write at. */
interface StartupLogger {
  info(context: Record<string, unknown>, message: string): void
  warn(context: Record<string, unknown>, message: string): void
}

interface DeferredLogger {
  logger: StartupLogger
  /** Points the logger at the app's stream, once there is one. */
  attach(target: FastifyBaseLogger): void
}

/**
 * A logger for the services built before the app exists.
 *
 * The settings service and its shared cache are constructed first, so that `buildApp` can be
 * handed a finished one, but neither says anything before the server is listening. This forwards
 * to the real logger from the moment there is one, and drops whatever came earlier.
 */
function createDeferredLogger(): DeferredLogger {
  let target: FastifyBaseLogger | undefined
  return {
    logger: {
      info: (context, message) => target?.info(context, message),
      warn: (context, message) => target?.warn(context, message),
    },
    attach(next) {
      target = next
    },
  }
}

async function main(): Promise<void> {
  let app: Awaited<ReturnType<typeof buildApp>>
  let sessionRedis: Redis | undefined

  try {
    const config = loadConfig()
    // The pool opens lazily; readiness (spec 05 §3) is what proves Postgres answers.
    initializeDatabase(config.databaseUrl)

    sessionRedis = await openSessionRedis(config)
    const sessionStore = createConfiguredSessionStore(config, {
      database: getDatabase(),
      redis: sessionRedis as SessionRedisClient | undefined,
    })

    // Spec 06 §4: the five-minute shared layer under the thirty-second in-process one. It rides
    // on the session connection, which is the client this process already has; unlike sessions,
    // a settings read that fails simply goes to the database.
    const deferred = createDeferredLogger()
    const sharedSettingsCache: SharedSettingsCache | undefined =
      sessionRedis === undefined
        ? undefined
        : createRedisSettingsCache(sessionRedis as SettingsRedisClient, {
            logger: deferred.logger,
          })
    const organizationSettings = createOrganizationSettingsService(getDatabase(), {
      logger: deferred.logger,
      ...(sharedSettingsCache === undefined ? {} : { sharedCache: sharedSettingsCache }),
    })

    const readinessChecks: ReadinessCheck[] = [
      { name: 'postgres', check: () => checkDatabaseReady() },
    ]
    if (sessionRedis !== undefined) {
      const client = sessionRedis
      readinessChecks.push({
        name: 'redis',
        check: async () => {
          await client.ping()
        },
      })
    }

    // Hooks and jobs are attached while the app is being built: once `buildApp` has awaited
    // readiness, Fastify refuses further hooks.
    app = await buildApp({
      config,
      sessionStore,
      organizationSettings,
      readinessChecks,
      plugins: [
        createIdentityPlugin(),
        (app) => {
          app.addHook('onClose', async () => {
            sessionRedis?.disconnect()
            await closeDatabase()
          })
        },
        (app) => {
          // Housekeeping runs inside the serving process (spec 09 §1); the advisory lock in
          // each job is what keeps a fleet of replicas from doing the same work several times.
          startBackgroundJobs(app, { db: getDatabase(), sql: getSql(), sessionStore })
        },
      ],
    })
    deferred.attach(app.log)
    // Operators need to see what the process actually decided (spec 09 §4).
    app.log.info({ config: describeConfig(config) }, 'effective configuration')
    app.log.info(
      { store: sessionRedis === undefined ? 'postgres' : 'redis' },
      'session store selected',
    )

    await app.listen({ port: config.port, host: config.host })
  } catch (error) {
    sessionRedis?.disconnect()
    if (error instanceof ConfigurationError) {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 78 // EX_CONFIG
      return
    }
    process.stderr.write(`Failed to start: ${String(error)}\n`)
    process.exitCode = 1
    return
  }

  const shutdown = (signal: NodeJS.Signals): void => {
    app.log.info({ signal }, 'shutting down')
    void app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        app.log.error({ err: error }, 'shutdown failed')
        process.exit(1)
      },
    )
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

await main()

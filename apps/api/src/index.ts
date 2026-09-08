// Process entry point: read the environment, build the application, and serve.

import type { DeploymentConfig } from '@golinks/shared/config'
import { describeConfig } from '@golinks/shared/config'
import type { Redis } from 'ioredis'
import { buildApp } from './app.ts'
import { createIdentityPlugin } from './auth/plugin.ts'
import { createConfiguredSessionStore, type SessionRedisClient } from './auth/session-stores.ts'
import { ConfigurationError, loadConfig } from './config/load.ts'
import { checkDatabaseReady, closeDatabase, getDatabase, initializeDatabase } from './db/client.ts'
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

    app = await buildApp({
      config,
      sessionStore,
      readinessChecks,
      plugins: [createIdentityPlugin()],
    })
    app.addHook('onClose', async () => {
      sessionRedis?.disconnect()
      await closeDatabase()
    })
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

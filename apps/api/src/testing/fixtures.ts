// Helpers shared by the unit tests. Nothing here touches a database or a network.

import type { DeploymentConfig, EnvironmentInput } from '@golinks/shared/config'
import type { InjectOptions } from 'fastify'
import { type BuildAppOptions, buildApp } from '../app.ts'
import { loadConfig } from '../config/load.ts'
import { loadDeploymentSettingsOverrides } from '../organizations/deployment-overrides.ts'
import type { GoLinksApp } from '../types.ts'

export const CANONICAL_ORIGIN = 'https://links.example.com'

/** A minimal environment that satisfies every required variable of spec 06 §1. */
export const BASE_ENVIRONMENT: Readonly<Record<string, string>> = Object.freeze({
  NODE_ENV: 'test',
  BASE_URL: CANONICAL_ORIGIN,
  DATABASE_URL: 'postgres://golinks:secret@localhost:5432/golinks',
  SESSION_SECRET: 'session-secret-that-is-long-enough-to-pass',
  OIDC_ISSUER: 'https://acme.okta.com',
  OIDC_CLIENT_ID: 'golinks-web',
  OIDC_CLIENT_SECRET: 'provider-secret',
})

export function testEnvironment(overrides: EnvironmentInput = {}): EnvironmentInput {
  return { ...BASE_ENVIRONMENT, ...overrides }
}

export function testConfig(overrides: EnvironmentInput = {}): DeploymentConfig {
  return loadConfig(testEnvironment(overrides))
}

export interface TestAppOptions extends Omit<BuildAppOptions, 'config'> {
  config?: DeploymentConfig
  environment?: EnvironmentInput
}

/**
 * Builds a silent instance with SPA hosting off unless a test asks for it.
 *
 * Injected requests carry the canonical host unless the test sets one of its own, because the
 * short-host bounce (spec 04 §2) answers everything that arrives under another name and
 * `app.inject` would otherwise address every request to `localhost`.
 *
 * A test names the settings its deployment fixes (spec 06 §6) either directly, through
 * `settingsOverrides`, or through `CONFIG_DIR` and `SETTINGS_OVERRIDES_JSON` in `environment`,
 * which are read here exactly as they are at startup.
 */
export async function buildTestApp(options: TestAppOptions = {}): Promise<GoLinksApp> {
  const { config, environment, ...rest } = options
  const resolved = config ?? testConfig(environment)
  const settingsOverrides =
    rest.settingsOverrides ?? loadDeploymentSettingsOverrides(resolved).overrides
  const app = await buildApp({
    config: resolved,
    logger: false,
    webDistPath: null,
    ...rest,
    settingsOverrides,
  })
  return withDefaultInjectedHost(app, resolved.canonicalHost)
}

/** Every shape `app.inject` accepts, collapsed to the one this wrapper has to forward. */
type Injector = (options?: InjectOptions | string, callback?: unknown) => unknown

/** Wraps `app.inject` so that a test only mentions the host when the host is the point. */
function withDefaultInjectedHost(app: GoLinksApp, host: string): GoLinksApp {
  const inject = app.inject.bind(app) as unknown as Injector

  const patched: Injector = (options, callback) => {
    if (options === undefined) return inject()
    const withHost: InjectOptions =
      typeof options === 'string'
        ? { url: options, headers: { host } }
        : { ...options, headers: { host, ...options.headers } }
    return callback === undefined ? inject(withHost) : inject(withHost, callback)
  }

  app.inject = patched as unknown as GoLinksApp['inject']
  return app
}

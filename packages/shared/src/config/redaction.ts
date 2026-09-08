// The service logs its effective non-secret configuration at startup (spec 09 §4).

import { formatDuration } from './duration.ts'
import type { DeploymentConfig } from './environment.ts'

const REDACTED = '[redacted]'

const CREDENTIALS_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@]*):([^/@]*)@/

/** Keeps the shape of a connection string but drops the password. */
export function redactConnectionString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return value.replace(
    CREDENTIALS_PATTERN,
    (_match, scheme: string, user: string) => `${scheme}${user}:${REDACTED}@`,
  )
}

/**
 * A plain object describing the running configuration with every secret removed. Safe to log
 * and safe to hand to an operator debugging a deployment.
 */
export function describeConfig(config: DeploymentConfig): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    host: config.host,
    port: config.port,
    logLevel: config.logLevel,
    baseUrl: config.baseUrl,
    shortHost: config.shortHost,
    trustProxy: config.trustProxy,
    databaseUrl: redactConnectionString(config.databaseUrl),
    redisUrl: redactConnectionString(config.redisUrl) ?? null,
    migrateOnStart: config.migrateOnStart,
    session: {
      secret: REDACTED,
      cookieName: config.session.cookieName,
      cookieSecure: config.session.cookieSecure,
      maxAge: formatDuration(config.session.maxAgeMs),
      idleTimeout:
        config.session.idleTimeoutMs === undefined
          ? null
          : formatDuration(config.session.idleTimeoutMs),
    },
    oidc: {
      logoutAtIdp: config.oidc.logoutAtIdp,
      providers: config.oidc.providers.map((provider) => ({
        id: provider.id,
        label: provider.label,
        issuer: provider.issuer,
        clientId: provider.clientId,
        clientSecret: REDACTED,
        scopes: provider.scopes,
        adminGroups: provider.adminGroups,
      })),
    },
    organizations: {
      resolution: config.organizations.resolution,
      fixedId: config.organizations.fixedId ?? null,
      domainAliases: config.organizations.domainAliases,
      allowedIds: config.organizations.allowedIds,
      initialAdminEmails: config.organizations.initialAdminEmails,
    },
    transfers: { tokenTtl: formatDuration(config.transfers.tokenTtlMs) },
    suggestions: config.suggestions,
    visits: config.visits,
    rateLimit: {
      enabled: config.rateLimit.enabled,
      window: formatDuration(config.rateLimit.windowMs),
      apiPerWindow: config.rateLimit.apiPerWindow,
      linkCreatePerWindow: config.rateLimit.linkCreatePerWindow,
      resolverPerWindow: config.rateLimit.resolverPerWindow,
    },
    authTest: {
      enabled: config.authTest.enabled,
      secret: config.authTest.secret === undefined ? null : REDACTED,
      domains: config.authTest.domains,
    },
    metrics: config.metrics,
    jobs: { enabled: config.jobs.enabled },
    webDistPath: config.webDistPath ?? null,
  }
}

// Deployment configuration: the environment variables of spec 06 §1, parsed once at startup.
//
// The schema is pure and browser-safe: it reads no files and imports nothing from Node. The
// loader that hands it `process.env` lives in the API package.

import { z } from 'zod'
import { parseDuration } from './duration.ts'
import { type HttpOrigin, parseHttpOrigin } from './urls.ts'

/** Session cookie name fixed by spec 02 §3. */
export const SESSION_COOKIE_NAME = 'gl_session'

/** Short-lived sign-in cookie name fixed by spec 02 §2. */
export const LOGIN_COOKIE_NAME = 'gl_login'

const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'] as const
const DEFAULT_PROVIDER_ID = 'oidc'

const TRUTHY = new Set(['true', '1', 'yes', 'on'])
const FALSY = new Set(['false', '0', 'no', 'off'])

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/

// --- variable-level parsers -------------------------------------------------

const booleanVariable = z.string().transform((value, ctx) => {
  const normalized = value.trim().toLowerCase()
  if (TRUTHY.has(normalized)) return true
  if (FALSY.has(normalized)) return false
  ctx.addIssue({ code: 'custom', message: `expected true or false, received "${value}"` })
  return z.NEVER
})

const durationVariable = z.string().transform((value, ctx) => {
  try {
    return parseDuration(value)
  } catch (cause) {
    ctx.addIssue({ code: 'custom', message: (cause as Error).message })
    return z.NEVER
  }
})

function integerVariable(bounds: { min?: number; max?: number } = {}) {
  return z.string().transform((value, ctx) => {
    const parsed = Number(value.trim())
    if (!Number.isInteger(parsed)) {
      ctx.addIssue({ code: 'custom', message: `expected a whole number, received "${value}"` })
      return z.NEVER
    }
    if (bounds.min !== undefined && parsed < bounds.min) {
      ctx.addIssue({ code: 'custom', message: `must be at least ${bounds.min}` })
      return z.NEVER
    }
    if (bounds.max !== undefined && parsed > bounds.max) {
      ctx.addIssue({ code: 'custom', message: `must be at most ${bounds.max}` })
      return z.NEVER
    }
    return parsed
  })
}

function decimalVariable(bounds: { min: number; max: number }) {
  return z.string().transform((value, ctx) => {
    const parsed = Number(value.trim())
    if (!Number.isFinite(parsed)) {
      ctx.addIssue({ code: 'custom', message: `expected a number, received "${value}"` })
      return z.NEVER
    }
    if (parsed < bounds.min || parsed > bounds.max) {
      ctx.addIssue({ code: 'custom', message: `must be between ${bounds.min} and ${bounds.max}` })
      return z.NEVER
    }
    return parsed
  })
}

/** `a,b , c` becomes `['a', 'b', 'c']`. Blank entries are dropped. */
function listVariable(options: { lowercase?: boolean } = {}) {
  return z.string().transform((value) =>
    value
      .split(',')
      .map((entry) => (options.lowercase ? entry.trim().toLowerCase() : entry.trim()))
      .filter((entry) => entry.length > 0),
  )
}

/** `acme.co.uk=acme.com,jane@gmail.com=acme.com` becomes a lookup map (spec 01 §1.2). */
const aliasMapVariable = z.string().transform((value, ctx) => {
  const aliases: Record<string, string> = {}
  for (const entry of value.split(',')) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) continue
    const separator = trimmed.indexOf('=')
    const from = separator === -1 ? '' : trimmed.slice(0, separator).trim().toLowerCase()
    const to =
      separator === -1
        ? ''
        : trimmed
            .slice(separator + 1)
            .trim()
            .toLowerCase()
    if (from.length === 0 || to.length === 0) {
      ctx.addIssue({ code: 'custom', message: `expected "from=to" pairs, received "${trimmed}"` })
      return z.NEVER
    }
    aliases[from] = to
  }
  return aliases
})

/** An absolute http(s) origin with no path, query, or fragment. */
const originVariable = z.string().transform((value, ctx): HttpOrigin => {
  const origin = parseHttpOrigin(value)
  if (origin === undefined) {
    ctx.addIssue({
      code: 'custom',
      message: `expected an http or https origin with no path, received "${value}"`,
    })
    return z.NEVER
  }
  return origin
})

const scopesVariable = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(/[\s,]+/))
      .map((scope) => scope.trim())
      .filter((scope) => scope.length > 0),
  )

const groupsVariable = z
  .union([z.string(), z.array(z.string())])
  .transform((value) =>
    (Array.isArray(value) ? value : value.split(','))
      .map((group) => group.trim())
      .filter((group) => group.length > 0),
  )

// --- identity providers (spec 02 §1) ---------------------------------------

export const oidcProviderSchema = z.object({
  id: z.string().trim().regex(PROVIDER_ID_PATTERN, 'must be lowercase letters, digits, and dashes'),
  label: z.string().trim().min(1).default('Sign in'),
  issuer: z.string().trim().min(1),
  clientId: z.string().trim().min(1),
  clientSecret: z.string().min(1),
  scopes: scopesVariable.default([...DEFAULT_OIDC_SCOPES]),
  adminGroups: groupsVariable.default([]),
  iconUrl: z
    .string()
    .trim()
    .min(1)
    .nullish()
    .transform((value) => value ?? null),
})

export type OidcProvider = z.output<typeof oidcProviderSchema>

const oidcProvidersJsonVariable = z
  .string()
  .transform((value, ctx): unknown[] => {
    let parsed: unknown
    try {
      parsed = JSON.parse(value)
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be valid JSON' })
      return z.NEVER
    }
    if (!Array.isArray(parsed)) {
      ctx.addIssue({ code: 'custom', message: 'must be a JSON array of providers' })
      return z.NEVER
    }
    return parsed
  })
  .pipe(z.array(oidcProviderSchema).min(1, 'must list at least one provider'))
  .superRefine((providers, ctx) => {
    const seen = new Set<string>()
    for (const provider of providers) {
      if (seen.has(provider.id)) {
        ctx.addIssue({ code: 'custom', message: `duplicate provider id "${provider.id}"` })
        return
      }
      seen.add(provider.id)
    }
  })

// --- the raw variable table (spec 06 §1) -----------------------------------

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const
export type LogLevel = (typeof LOG_LEVELS)[number]

export const ORG_RESOLUTION_STRATEGIES = ['domain', 'fixed'] as const
export type OrganizationResolution = (typeof ORG_RESOLUTION_STRATEGIES)[number]

const environmentVariables = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: integerVariable({ min: 1, max: 65535 }).default(3000),
  HOST: z.string().trim().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  BASE_URL: originVariable,
  SHORT_HOST: z.string().trim().min(1).default('go'),
  TRUST_PROXY: booleanVariable.default(false),

  DATABASE_URL: z.string().trim().min(1),
  REDIS_URL: z.string().trim().min(1).optional(),
  MIGRATE_ON_START: booleanVariable.default(false),

  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  SESSION_MAX_AGE: durationVariable.prefault('30d'),
  SESSION_IDLE_TIMEOUT: durationVariable.optional(),

  OIDC_ID: z
    .string()
    .trim()
    .regex(PROVIDER_ID_PATTERN, 'must be lowercase letters, digits, and dashes')
    .default(DEFAULT_PROVIDER_ID),
  OIDC_ISSUER: z.string().trim().min(1).optional(),
  OIDC_CLIENT_ID: z.string().trim().min(1).optional(),
  OIDC_CLIENT_SECRET: z.string().min(1).optional(),
  OIDC_SCOPES: scopesVariable.default([...DEFAULT_OIDC_SCOPES]),
  OIDC_LABEL: z.string().trim().min(1).default('Sign in'),
  OIDC_ADMIN_GROUPS: groupsVariable.default([]),
  OIDC_PROVIDERS_JSON: oidcProvidersJsonVariable.optional(),
  OIDC_LOGOUT_AT_IDP: booleanVariable.default(false),

  ORG_RESOLUTION: z.enum(ORG_RESOLUTION_STRATEGIES).default('domain'),
  ORG_FIXED_ID: z.string().trim().min(1).toLowerCase().optional(),
  ORG_DOMAIN_ALIASES: aliasMapVariable.default({}),
  ORG_ALLOWED_IDS: listVariable({ lowercase: true }).default([]),
  INITIAL_ADMIN_EMAILS: listVariable({ lowercase: true }).default([]),

  TRANSFER_TOKEN_TTL: durationVariable.prefault('24h'),
  SUGGESTION_MIN_SIMILARITY: decimalVariable({ min: 0, max: 1 }).default(0.3),
  VISIT_RETENTION_DAYS: integerVariable({ min: 1 }).default(365),

  RATE_LIMIT_ENABLED: booleanVariable.default(true),
  RATE_LIMIT_WINDOW: durationVariable.prefault('1m'),
  RATE_LIMIT_API: integerVariable({ min: 1 }).default(600),
  RATE_LIMIT_LINK_CREATE: integerVariable({ min: 1 }).default(60),
  RATE_LIMIT_RESOLVER: integerVariable({ min: 1 }).default(1200),

  AUTH_TEST_MODE: booleanVariable.default(false),
  AUTH_TEST_SECRET: z.string().min(1).optional(),
  AUTH_TEST_DOMAINS: listVariable({ lowercase: true }).default([]),

  METRICS_ENABLED: booleanVariable.default(false),
  JOBS_ENABLED: booleanVariable.default(true),
  WEB_DIST_PATH: z.string().trim().min(1).optional(),
})

// --- the shape the application actually uses --------------------------------

export interface DeploymentConfig {
  nodeEnv: 'development' | 'test' | 'production'
  isProduction: boolean
  port: number
  host: string
  logLevel: LogLevel
  /** Canonical origin from BASE_URL, without a trailing slash. */
  baseUrl: string
  /** Host and port members reach the canonical origin on. */
  canonicalHost: string
  /** True when BASE_URL is https, which is what turns HSTS on (spec 02 §7). */
  isCanonicalSecure: boolean
  shortHost: string
  trustProxy: boolean
  databaseUrl: string
  redisUrl: string | undefined
  migrateOnStart: boolean
  session: {
    secret: string
    cookieName: string
    /** Omitted only for a plain-http loopback BASE_URL (spec 02 §3). */
    cookieSecure: boolean
    maxAgeMs: number
    idleTimeoutMs: number | undefined
  }
  oidc: {
    providers: OidcProvider[]
    logoutAtIdp: boolean
  }
  organizations: {
    resolution: OrganizationResolution
    fixedId: string | undefined
    domainAliases: Record<string, string>
    allowedIds: string[]
    initialAdminEmails: string[]
  }
  transfers: { tokenTtlMs: number }
  suggestions: { minSimilarity: number }
  visits: { retentionDays: number }
  rateLimit: {
    enabled: boolean
    windowMs: number
    apiPerWindow: number
    linkCreatePerWindow: number
    resolverPerWindow: number
  }
  authTest: {
    enabled: boolean
    secret: string | undefined
    domains: string[]
  }
  metrics: { enabled: boolean }
  /** Whether this replica runs the scheduled background jobs (spec 09 §1). */
  jobs: { enabled: boolean }
  webDistPath: string | undefined
}

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function singleProvider(
  variables: z.output<typeof environmentVariables>,
): OidcProvider | undefined {
  const { OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET } = variables
  if (!OIDC_ISSUER || !OIDC_CLIENT_ID || !OIDC_CLIENT_SECRET) return undefined
  return {
    id: variables.OIDC_ID,
    label: variables.OIDC_LABEL,
    issuer: OIDC_ISSUER,
    clientId: OIDC_CLIENT_ID,
    clientSecret: OIDC_CLIENT_SECRET,
    scopes: variables.OIDC_SCOPES,
    adminGroups: variables.OIDC_ADMIN_GROUPS,
    iconUrl: null,
  }
}

function toDeploymentConfig(variables: z.output<typeof environmentVariables>): DeploymentConfig {
  const base = variables.BASE_URL
  const isCanonicalSecure = base.protocol === 'https:'
  const isLoopback = !isCanonicalSecure && LOOPBACK_HOSTNAMES.has(base.hostname)

  // OIDC_PROVIDERS_JSON wins over the single-provider variables (spec 02 §1).
  const single = singleProvider(variables)
  const providers = variables.OIDC_PROVIDERS_JSON ?? (single ? [single] : [])

  return {
    nodeEnv: variables.NODE_ENV,
    isProduction: variables.NODE_ENV === 'production',
    port: variables.PORT,
    host: variables.HOST,
    logLevel: variables.LOG_LEVEL,
    baseUrl: base.origin,
    canonicalHost: base.host,
    isCanonicalSecure,
    shortHost: variables.SHORT_HOST,
    trustProxy: variables.TRUST_PROXY,
    databaseUrl: variables.DATABASE_URL,
    redisUrl: variables.REDIS_URL,
    migrateOnStart: variables.MIGRATE_ON_START,
    session: {
      secret: variables.SESSION_SECRET,
      cookieName: SESSION_COOKIE_NAME,
      cookieSecure: !isLoopback,
      maxAgeMs: variables.SESSION_MAX_AGE,
      idleTimeoutMs: variables.SESSION_IDLE_TIMEOUT,
    },
    oidc: {
      providers,
      logoutAtIdp: variables.OIDC_LOGOUT_AT_IDP,
    },
    organizations: {
      resolution: variables.ORG_RESOLUTION,
      fixedId: variables.ORG_FIXED_ID,
      domainAliases: variables.ORG_DOMAIN_ALIASES,
      allowedIds: variables.ORG_ALLOWED_IDS,
      initialAdminEmails: variables.INITIAL_ADMIN_EMAILS,
    },
    transfers: { tokenTtlMs: variables.TRANSFER_TOKEN_TTL },
    suggestions: { minSimilarity: variables.SUGGESTION_MIN_SIMILARITY },
    visits: { retentionDays: variables.VISIT_RETENTION_DAYS },
    rateLimit: {
      enabled: variables.RATE_LIMIT_ENABLED,
      windowMs: variables.RATE_LIMIT_WINDOW,
      apiPerWindow: variables.RATE_LIMIT_API,
      linkCreatePerWindow: variables.RATE_LIMIT_LINK_CREATE,
      resolverPerWindow: variables.RATE_LIMIT_RESOLVER,
    },
    authTest: {
      enabled: variables.AUTH_TEST_MODE,
      secret: variables.AUTH_TEST_SECRET,
      domains: variables.AUTH_TEST_DOMAINS,
    },
    metrics: { enabled: variables.METRICS_ENABLED },
    jobs: { enabled: variables.JOBS_ENABLED },
    webDistPath: variables.WEB_DIST_PATH,
  }
}

/** Environment entries set to an empty string are treated as unset. */
function withoutBlankValues(input: unknown): unknown {
  if (input === null || typeof input !== 'object') return input
  const source = input as Record<string, unknown>
  const cleaned: Record<string, unknown> = {}
  for (const key of Object.keys(source)) {
    const value = source[key]
    if (typeof value === 'string' && value.trim().length === 0) continue
    if (value === undefined) continue
    cleaned[key] = value
  }
  return cleaned
}

/**
 * Parses a raw environment into the deployment configuration, applying the startup refusals
 * of spec 02 §1 and §8.
 */
export const environmentSchema = z
  .preprocess(withoutBlankValues, environmentVariables)
  .superRefine((variables, ctx) => {
    const configured = [
      variables.OIDC_ISSUER,
      variables.OIDC_CLIENT_ID,
      variables.OIDC_CLIENT_SECRET,
    ]
    const present = configured.filter((value) => value !== undefined).length
    const partiallyConfigured =
      present > 0 && present < configured.length && !variables.OIDC_PROVIDERS_JSON
    if (partiallyConfigured) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_ISSUER'],
        message:
          'OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET must be set together, or replaced by OIDC_PROVIDERS_JSON',
      })
    }
    if (variables.ORG_RESOLUTION === 'fixed' && variables.ORG_FIXED_ID === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['ORG_FIXED_ID'],
        message: 'is required when ORG_RESOLUTION is "fixed"',
      })
    }
    if (variables.AUTH_TEST_MODE && variables.NODE_ENV === 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_TEST_MODE'],
        message: 'test sign-in cannot be enabled when NODE_ENV is "production"',
      })
    }
    if (variables.AUTH_TEST_MODE && variables.AUTH_TEST_SECRET === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['AUTH_TEST_SECRET'],
        message: 'is required when AUTH_TEST_MODE is enabled',
      })
    }
    const hasProvider =
      variables.OIDC_PROVIDERS_JSON !== undefined || singleProvider(variables) !== undefined
    if (!hasProvider && !partiallyConfigured && !variables.AUTH_TEST_MODE) {
      ctx.addIssue({
        code: 'custom',
        path: ['OIDC_ISSUER'],
        message:
          'no identity provider is configured; set OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET, or OIDC_PROVIDERS_JSON, or enable AUTH_TEST_MODE',
      })
    }
  })
  .transform(toDeploymentConfig)

export type EnvironmentInput = Record<string, string | undefined>

/** Turns a failed parse into the lines the process prints before exiting. */
export function formatEnvironmentIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const variable = issue.path.length > 0 ? issue.path.join('.') : 'environment'
    return `${variable}: ${issue.message}`
  })
}

// Instance-level types and the Fastify decorations the service adds.

import type { UserRole } from '@golinks/shared/api'
import type { DeploymentConfig } from '@golinks/shared/config'
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyRequest,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { Database } from './db/client.ts'
import type { OrganizationSettingsService } from './organizations/settings-service.ts'
import type { NamedRateLimits, RateLimitSubjectResolver } from './security/rate-limits.ts'

/**
 * One dependency `/_/health/ready` asks about. `check` resolves when the dependency answers
 * and rejects with the reason when it does not.
 */
export interface ReadinessCheck {
  name: string
  check(): Promise<void>
}

/**
 * The signed-in member a request acts as (spec 02 §5). Populated on every request by the
 * member resolver before any route runs; `null` means unauthenticated.
 */
export interface CurrentMember {
  id: string
  email: string
  organizationId: string
  role: UserRole
}

/**
 * Turns a request into the member behind it, or `null`. The sign-in module installs the
 * real one (session cookie to user row); tests install fakes.
 */
export type MemberResolver = (request: FastifyRequest) => Promise<CurrentMember | null>

/** The Fastify instance this service builds: zod schemas in, zod schemas out. */
export type GoLinksApp = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  FastifyBaseLogger,
  ZodTypeProvider
>

declare module 'fastify' {
  interface FastifyInstance {
    /** The validated deployment configuration this instance was built from. */
    appConfig: DeploymentConfig
    /** Named limit configurations routes attach to themselves (spec 05 §5). */
    rateLimits: NamedRateLimits
    /** Registers a dependency for `/_/health/ready` to probe. */
    addReadinessCheck(check: ReadinessCheck): void
    /** Everything `/_/health/ready` currently probes. */
    readinessChecks(): readonly ReadinessCheck[]
    /** Who the next rate-limited request is counted against. */
    resolveRateLimitSubject(request: FastifyRequest): string | undefined
    /** Replaces the subject resolver; the sign-in task uses this to count per session. */
    setRateLimitSubjectResolver(resolver: RateLimitSubjectResolver): void
    /**
     * The database handle routes and services read and write through. Defaults to the
     * process-wide connection opened at startup; tests pass their own to `buildApp`.
     */
    db: Database
    /** Organization settings with their cache (spec 06 §4). */
    organizationSettings: OrganizationSettingsService
    /** Replaces how `request.member` is populated. */
    setMemberResolver(resolver: MemberResolver): void
  }

  interface FastifyRequest {
    /** The signed-in member, or `null`. Set before any route handler or later hook runs. */
    member: CurrentMember | null
  }
}

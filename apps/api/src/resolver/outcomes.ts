// Classifies a finished resolver response for the metrics (spec 07 §3). The route only ever
// answers with a redirect, a 502 for an unserializable destination, or an error, so the
// status and the redirect target are enough to tell the outcomes apart.

import type { ResolverOutcome } from '../metrics/registry.ts'
import {
  DIRECTORY_PATH,
  LOGIN_PATH,
  RESOLVER_REDIRECT_STATUS,
  UNSERIALIZABLE_DESTINATION_STATUS,
} from './redirect.ts'

/**
 * Returns `null` for responses that were not a resolution at all: a 404 for an application
 * path that reached the catch-all, a 405, a rate-limit refusal.
 */
export function resolverOutcomeOf(
  statusCode: number,
  location: string | undefined,
): ResolverOutcome | null {
  if (statusCode === UNSERIALIZABLE_DESTINATION_STATUS || statusCode >= 500) return 'error'
  if (statusCode !== RESOLVER_REDIRECT_STATUS || location === undefined) return null
  if (location.startsWith(LOGIN_PATH)) return 'unauthenticated'
  if (location.startsWith(DIRECTORY_PATH)) return 'miss'
  return 'hit'
}

/** Fastify hands back headers as string, string[], or number; only a string can be a Location. */
export function locationHeaderOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return undefined
}

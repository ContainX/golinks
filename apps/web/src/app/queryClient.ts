import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/http.ts'

/** Retries beyond this are noise; the API is on the same origin. */
const MAX_QUERY_ATTEMPTS = 3

/**
 * A request the API has already answered with a client error will be answered
 * the same way again, so only transport failures and server errors are retried.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) {
    return false
  }
  return failureCount < MAX_QUERY_ATTEMPTS
}

/**
 * The React Query client for the app. Created by the caller rather than shared
 * as a module singleton so that each test gets an empty cache.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  })
}

/**
 * Rendering hooks against a cache of their own.
 *
 * Each test gets an empty {@link QueryClient} with retries off, so that a
 * failed request settles at once rather than being tried again while the test
 * waits.
 */

import type { QueryKey } from '@tanstack/react-query'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { vi } from 'vitest'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        // React Query re-renders only for the result properties a component
        // read on its last render. A test that asserts on a property it has
        // not read yet would see a stale result, which says nothing about the
        // hook; here every change is a render.
        notifyOnChangeProps: 'all',
      },
      mutations: { retry: false },
    },
  })
}

export interface QueryHarness {
  queryClient: QueryClient
  wrapper: (props: { children: ReactNode }) => ReactNode
}

export function createQueryHarness(queryClient = createTestQueryClient()): QueryHarness {
  return {
    queryClient,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  }
}

/**
 * Watches what a mutation makes stale.
 *
 * Returns a reader for the keys passed to `invalidateQueries`, in the order
 * they were invalidated, which is what a mutation's contract with the cache
 * amounts to.
 */
export function watchInvalidations(queryClient: QueryClient): () => (QueryKey | undefined)[] {
  const spy = vi.spyOn(queryClient, 'invalidateQueries')
  return () => spy.mock.calls.map(([filters]) => filters?.queryKey)
}

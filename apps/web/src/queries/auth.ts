/**
 * What the sign-in page needs before anyone is signed in (spec 02 §2 step 1).
 *
 * The endpoint is public and changes only when a deployment is reconfigured,
 * so the answer is cached for the life of the page and never retried against a
 * refusal.
 */

import { useQuery } from '@tanstack/react-query'
import { getSignInOptions } from '../api/auth.ts'
import type { QueryHookOptions } from './keys.ts'

/**
 * The key for the sign-in options.
 *
 * It is declared here rather than in the `queryKeys` factory because nothing
 * else in the cache relates to it: it is read by one screen, invalidated by
 * nothing, and belongs to no member.
 */
const SIGN_IN_OPTIONS_KEY = ['auth', 'signInOptions'] as const

/** The providers to offer and whether test sign-in is enabled. */
export function useSignInOptions(options: QueryHookOptions = {}) {
  return useQuery({
    queryKey: SIGN_IN_OPTIONS_KEY,
    queryFn: ({ signal }) => getSignInOptions({ signal }),
    staleTime: Number.POSITIVE_INFINITY,
    ...options,
  })
}

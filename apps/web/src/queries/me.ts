/**
 * The signed-in member (spec 05 §3).
 *
 * `GET /me` answers the questions the whole app is built on — who is this, what
 * has the organization configured, what is this deployment called — so it is
 * fetched once and read from the cache everywhere else.
 */

import type { MePatchBody } from '@golinks/shared/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getMe, patchMe } from '../api/me.ts'
import type { QueryHookOptions } from './keys.ts'
import { queryKeys } from './keys.ts'

/**
 * The current session.
 *
 * A member with no session is answered 401, which the transport turns into a
 * trip to sign-in (spec 02 §2); the query settles as an error in the meantime
 * and is not retried.
 */
export function useMe(options: QueryHookOptions = {}) {
  return useQuery({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => getMe({ signal }),
    ...options,
  })
}

/**
 * Stores the member's own preferences (spec 01 §2.5).
 *
 * The response is the whole `Me` document, so it replaces the cached one
 * outright; nothing else in the cache depends on it.
 */
export function usePatchMe() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: MePatchBody) => patchMe(body),
    onSuccess: (me) => {
      queryClient.setQueryData(queryKeys.me(), me)
    },
  })
}

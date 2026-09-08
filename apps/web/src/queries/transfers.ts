/**
 * Accepting ownership of a link (spec 08 §6).
 *
 * The token in `/_/transfer/:token` is the only thing the screen has, so it is
 * what the cache is keyed by.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { acceptTransfer, previewTransfer } from '../api/transfers.ts'
import type { QueryHookOptions } from './keys.ts'
import { queryKeys } from './keys.ts'

/** What is on offer, and whether the offer still stands. */
export function useTransferPreview(token: string, options: QueryHookOptions = {}) {
  return useQuery({
    queryKey: queryKeys.transfers.preview(token),
    queryFn: ({ signal }) => previewTransfer(token, { signal }),
    ...options,
  })
}

/**
 * Takes the link over.
 *
 * The link now has a new owner, so the listings that show owners are refetched
 * and the offer itself is reread: its status has become `accepted`, and the
 * screen says so rather than offering the same button twice.
 */
export function useAcceptTransfer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (token: string) => acceptTransfer(token),
    onSuccess: (link, token) => {
      queryClient.setQueryData(queryKeys.links.detail(link.id), link)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.transfers.preview(token) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.links.lists() }),
      ])
    },
  })
}

/**
 * Links: the directory, one link, and the changes that can be made to it
 * (spec 08 §3, §4, §5).
 *
 * The directory is an infinite query over the cursors the API hands back
 * (spec 03 §10.1), so a screen can ask for another page without knowing how
 * paging works.
 */

import type { QueryClient } from '@tanstack/react-query'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  LinkCreateInput,
  LinkListParams,
  LinkPatchInput,
  LinkSuggestionsParams,
} from '../api/links.ts'
import {
  createLink,
  createTransfer,
  deleteLink,
  getLink,
  listLinks,
  patchLink,
  suggestLinks,
} from '../api/links.ts'
import type { QueryHookOptions } from './keys.ts'
import { queryKeys } from './keys.ts'

/** Directory filters. The cursor is the query's business, not the caller's. */
export type LinkListFilters = Omit<LinkListParams, 'cursor'>

/** Arguments to a change of one link. */
export interface PatchLinkVariables {
  id: string
  body: LinkPatchInput
}

/**
 * The directory, one page at a time.
 *
 * `fetchNextPage` follows `nextCursor`; `hasNextPage` is false once the API
 * returns none, which is how the end of a large directory is recognized
 * without counting.
 */
export function useLinks(filters: LinkListFilters = {}, options: QueryHookOptions = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.links.list(filters),
    queryFn: ({ pageParam, signal }) =>
      listLinks({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...options,
  })
}

/** One link. */
export function useLink(id: string, options: QueryHookOptions = {}) {
  return useQuery({
    queryKey: queryKeys.links.detail(id),
    queryFn: ({ signal }) => getLink(id, { signal }),
    ...options,
  })
}

/**
 * Links whose keyword resembles one a member has in mind (spec 03 §10.2).
 *
 * Idle until there is a keyword to rank against, so that an empty form asks
 * nothing.
 */
export function useLinkSuggestions(params: LinkSuggestionsParams, options: QueryHookOptions = {}) {
  const { enabled = true, ...rest } = options
  return useQuery({
    queryKey: queryKeys.links.suggestionsFor(params),
    queryFn: ({ signal }) => suggestLinks(params, { signal }),
    enabled: enabled && params.keyword.trim().length > 0,
    ...rest,
  })
}

/**
 * Every listing and every suggestion may now read differently, so both are
 * refetched. Details are left alone: they are keyed by id, and a change to one
 * link says nothing about another.
 */
function invalidateLinkCollections(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.links.lists() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.links.suggestions() }),
  ])
}

/** Creates a link (spec 08 §4). */
export function useCreateLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (body: LinkCreateInput) => createLink(body),
    onSuccess: (link) => {
      queryClient.setQueryData(queryKeys.links.detail(link.id), link)
      return invalidateLinkCollections(queryClient)
    },
  })
}

/** Changes a link's destination, keyword, namespace, visibility, or owner. */
export function usePatchLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: PatchLinkVariables) => patchLink(id, body),
    onSuccess: (link) => {
      queryClient.setQueryData(queryKeys.links.detail(link.id), link)
      return invalidateLinkCollections(queryClient)
    },
  })
}

/** Deletes a link. Its cached detail goes with it. */
export function useDeleteLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) => deleteLink(id),
    onSuccess: (_result, id) => {
      queryClient.removeQueries({ queryKey: queryKeys.links.detail(id) })
      return invalidateLinkCollections(queryClient)
    },
  })
}

/**
 * Offers a link to another member (spec 03 §9.2).
 *
 * Nothing cached changes: the transfer is a new object no listing shows, and
 * the link keeps its owner until the offer is accepted.
 */
export function useCreateTransfer() {
  return useMutation({
    mutationFn: (linkId: string) => createTransfer(linkId),
  })
}

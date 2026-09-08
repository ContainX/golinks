/**
 * Administration: members, the organization's settings document, and the audit
 * trail (spec 05 §3, spec 06 §2, spec 07).
 *
 * Both listings page over cursors the same way the directory does.
 */

import type { AdminSettingsPutBody, AdminUserPatchBody, Link } from '@golinks/shared/api'
import { MAX_LIST_LIMIT } from '@golinks/shared/api'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminEventsParams, AdminUsersParams } from '../api/admin.ts'
import {
  getSettings,
  getUser,
  listEvents,
  listUsers,
  patchUser,
  putSettings,
} from '../api/admin.ts'
import { listLinks, patchLink } from '../api/links.ts'
import type { QueryHookOptions } from './keys.ts'
import { queryKeys } from './keys.ts'

/** Member filters. The cursor belongs to the query. */
export type AdminUsersFilters = Omit<AdminUsersParams, 'cursor'>

/** Audit trail filters. The cursor belongs to the query. */
export type AdminEventsFilters = Omit<AdminEventsParams, 'cursor'>

/** Arguments to a change of one member. */
export interface PatchAdminUserVariables {
  id: string
  body: AdminUserPatchBody
}

/** The organization's members, one page at a time. */
export function useAdminUsers(filters: AdminUsersFilters = {}, options: QueryHookOptions = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.admin.users.list(filters),
    queryFn: ({ pageParam, signal }) =>
      listUsers({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...options,
  })
}

/** One member. */
export function useAdminUser(id: string, options: QueryHookOptions = {}) {
  return useQuery({
    queryKey: queryKeys.admin.users.detail(id),
    queryFn: ({ signal }) => getUser(id, { signal }),
    ...options,
  })
}

/** Enables, disables, or re-roles a member. */
export function usePatchAdminUser() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, body }: PatchAdminUserVariables) => patchUser(id, body),
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.admin.users.detail(user.id), user)
      return queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.lists() })
    },
  })
}

/**
 * How much of a member's directory the reassignment dialog will gather. Ten
 * full pages is far more than any one member owns in practice; the flag on the
 * result says when a member owns even more, so the screen can say so rather
 * than quietly move a part of them.
 */
const OWNED_LINKS_MAX_PAGES = 10

/** Everything one member owns, and whether that is all of it. */
export interface OwnedLinks {
  items: Link[]
  /** False when the member owns more links than were gathered. */
  complete: boolean
}

/** One link the reassignment could not move, and what the API said about it. */
export interface ReassignLinkFailure {
  link: Link
  message: string
}

/** What a reassignment did, whether or not every link went through. */
export interface ReassignLinksResult {
  moved: Link[]
  failures: ReassignLinkFailure[]
}

/** A reassignment: which links, to whom, and where to report progress. */
export interface ReassignLinksVariables {
  links: readonly Link[]
  /** The member who is to own them, as `PATCH /links/:id` names them. */
  ownerId: string
  /** Called after each link with the number attempted so far. */
  onProgress?: (completed: number) => void
}

/** Reads every page of `GET /links?owner=<id>` into one list. */
async function listLinksOwnedBy(userId: string, signal?: AbortSignal): Promise<OwnedLinks> {
  const items: Link[] = []
  let cursor: string | null = null

  for (let page = 0; page < OWNED_LINKS_MAX_PAGES; page += 1) {
    const response = await listLinks(
      { owner: userId, limit: MAX_LIST_LIMIT, ...(cursor === null ? {} : { cursor }) },
      { ...(signal ? { signal } : {}) },
    )
    items.push(...response.items)
    cursor = response.nextCursor
    if (cursor === null) {
      return { items, complete: true }
    }
  }

  return { items, complete: false }
}

/**
 * Every link a member owns (spec 03 §10.1).
 *
 * This is what the admin console asks before handing a member's links to
 * someone else, so it pages to the end rather than showing a first page: the
 * count on the button has to be the number of links that will actually move.
 *
 * The key hangs under the member it describes, so that a change to that member
 * — including the reassignment itself — takes it with it.
 */
export function useAdminUserLinks(userId: string, options: QueryHookOptions = {}) {
  return useQuery({
    queryKey: [...queryKeys.admin.users.detail(userId), 'links'],
    queryFn: ({ signal }) => listLinksOwnedBy(userId, signal),
    ...options,
  })
}

/**
 * Hands a set of links to another member, one `PATCH /links/:id` at a time.
 *
 * There is no bulk endpoint, and there is deliberately no burst of parallel
 * requests either: each write takes the organization's lock on that link's
 * keyword (spec 03 §6.1) and counts against the member's rate limit (spec 09
 * §6). So the links go one after another, the caller is told after each one,
 * and a link the API refuses is collected rather than abandoning the rest —
 * a half-finished move is still a move, and the summary says which links are
 * still where they were.
 */
async function reassignLinks(variables: ReassignLinksVariables): Promise<ReassignLinksResult> {
  const moved: Link[] = []
  const failures: ReassignLinkFailure[] = []

  for (const link of variables.links) {
    try {
      await patchLink(link.id, { ownerId: variables.ownerId })
      moved.push(link)
    } catch (error) {
      failures.push({
        link,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    variables.onProgress?.(moved.length + failures.length)
  }

  return { moved, failures }
}

/**
 * Reassignment as a mutation.
 *
 * Every listing of links is stale afterwards, and so is every member: link
 * counts moved from one row to another. Both are invalidated even when some
 * links failed, because the ones that went through have already changed hands.
 */
export function useReassignLinks() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: reassignLinks,
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.links.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all() }),
      ])
    },
  })
}

/** The settings document as an admin edits it (spec 06 §2). */
export function useAdminSettings(options: QueryHookOptions = {}) {
  return useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: ({ signal }) => getSettings({ signal }),
    ...options,
  })
}

/**
 * Replaces the settings document.
 *
 * Settings reach far beyond the admin screen: branding is the theme every
 * member sees, and a changed default namespace or punctuation rule rewrites the
 * keywords links resolve under (spec 06 §2, §3). So the session and every
 * listing of links are reread, which is what makes a new primary color show up
 * without a reload.
 */
export function usePutAdminSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings: AdminSettingsPutBody) => putSettings(settings),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.admin.settings(), settings)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.me() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.links.all() }),
      ])
    },
  })
}

/** The audit trail, one page at a time (spec 07). */
export function useAdminEvents(filters: AdminEventsFilters = {}, options: QueryHookOptions = {}) {
  return useInfiniteQuery({
    queryKey: queryKeys.admin.events.list(filters),
    queryFn: ({ pageParam, signal }) =>
      listEvents({ ...filters, ...(pageParam ? { cursor: pageParam } : {}) }, { signal }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    ...options,
  })
}

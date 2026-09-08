/**
 * Administration: members, the organization's settings document, and the audit
 * trail (spec 05 §3, spec 06 §2, spec 07).
 *
 * Both listings page over cursors the same way the directory does.
 */

import type { AdminSettingsPutBody, AdminUserPatchBody } from '@golinks/shared/api'
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

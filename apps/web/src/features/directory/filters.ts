/**
 * What the directory's chips and sort control mean to the API (spec 03 §10.1).
 *
 * The screen holds one chip id and one sort id; this module turns them into the
 * query the listing endpoint understands, so nothing above has to remember that
 * "Mine" is `owner=me` or that sorting by keyword ascends while everything else
 * descends.
 */

import type { LinkSort, SortOrder } from '@golinks/shared/api'
import type { LinkListFilters } from '../../queries/links.ts'

/** The chip a member has selected. Exactly one is active at a time. */
export type DirectoryFilterId = 'all' | 'mine' | 'programmatic' | 'unlisted' | `namespace:${string}`

export const ALL_FILTER: DirectoryFilterId = 'all'

/** The chip id for one of the organization's namespaces. */
export function namespaceFilter(namespace: string): DirectoryFilterId {
  return `namespace:${namespace}`
}

/** The namespace a chip id names, or `null` when it names something else. */
export function filterNamespace(filter: DirectoryFilterId): string | null {
  return filter.startsWith('namespace:') ? filter.slice('namespace:'.length) : null
}

export interface SortOption {
  id: LinkSort
  label: string
  /** The direction that reads as "most" for this column (spec 03 §10.1). */
  order: SortOrder
}

/**
 * The four sorts of spec 08 §3, in the order the control offers them. Visits
 * lead because popularity is the directory's default.
 */
const MOST_VISITED: SortOption = { id: 'visits', label: 'Most visited', order: 'desc' }

export const SORT_OPTIONS: readonly SortOption[] = [
  MOST_VISITED,
  { id: 'keyword', label: 'Keyword', order: 'asc' },
  { id: 'created', label: 'Recently created', order: 'desc' },
  { id: 'updated', label: 'Recently updated', order: 'desc' },
]

export const DEFAULT_SORT: LinkSort = MOST_VISITED.id

export function sortOption(id: LinkSort): SortOption {
  return SORT_OPTIONS.find((option) => option.id === id) ?? MOST_VISITED
}

export interface DirectoryQueryInput {
  /** The debounced contents of the search field. */
  search: string
  filter: DirectoryFilterId
  sort: LinkSort
}

/**
 * The listing query for the current chip, search, and sort.
 *
 * The unlisted chip has no counterpart in the query (spec 03 §10.1 has no
 * unlisted parameter — the visibility rule of §4 is always applied for the
 * viewer), so it narrows the rows that came back rather than the request. Every
 * other chip is a filter the API applies.
 */
export function directoryQuery({ search, filter, sort }: DirectoryQueryInput): LinkListFilters {
  const namespace = filterNamespace(filter)
  const option = sortOption(sort)

  return {
    ...(search.trim().length > 0 ? { q: search.trim() } : {}),
    ...(filter === 'mine' ? { owner: 'me' } : {}),
    ...(namespace === null ? {} : { namespace }),
    ...(filter === 'programmatic' ? { programmatic: true } : {}),
    sort: option.id,
    order: option.order,
  }
}

/** Whether the chip narrows the rows after they arrive rather than the request. */
export function isClientSideFilter(filter: DirectoryFilterId): boolean {
  return filter === 'unlisted'
}

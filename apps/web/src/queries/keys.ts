/**
 * The shape of the client cache.
 *
 * Every query in the app takes its key from this factory, and every mutation
 * invalidates a key from it, so that a cache entry is only ever named in one
 * place. Keys are arrays read from the general to the specific — `['links']`,
 * `['links', 'list']`, `['links', 'list', params]` — because React Query
 * matches by prefix: invalidating `links.lists()` reaches every page of every
 * filter, and `links.all()` reaches everything about links at once.
 */

/** A filter object as it appears inside a key. */
export type KeyParams = Readonly<Record<string, unknown>>

/**
 * Normalizes a filter object so that two callers asking the same question get
 * the same key.
 *
 * Keys are sorted, and a parameter that is absent, `null`, or empty is dropped:
 * a cleared search box must land on the entry a search that was never typed
 * created. This is the same rule the query string is built with, so a key and
 * the request it stands for always agree.
 */
export function stableParams(params: Record<string, unknown>): KeyParams {
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  )
  entries.sort(([left], [right]) => left.localeCompare(right))
  return Object.fromEntries(entries)
}

/** What every query hook lets a caller decide. */
export interface QueryHookOptions {
  /** Hold the request back until the screen is ready to ask for it. */
  enabled?: boolean
}

export const queryKeys = {
  /** The signed-in member, their organization, and the deployment (spec 05 §2.2). */
  me: () => ['me'] as const,

  links: {
    all: () => ['links'] as const,
    lists: () => ['links', 'list'] as const,
    /** One filtered, sorted directory listing; its pages live under this key. */
    list: (params: Record<string, unknown> = {}) =>
      ['links', 'list', stableParams(params)] as const,
    details: () => ['links', 'detail'] as const,
    detail: (id: string) => ['links', 'detail', id] as const,
    suggestions: () => ['links', 'suggestions'] as const,
    suggestionsFor: (params: Record<string, unknown>) =>
      ['links', 'suggestions', stableParams(params)] as const,
  },

  transfers: {
    all: () => ['transfers'] as const,
    /** Keyed by token: the preview is all the acceptance screen knows. */
    preview: (token: string) => ['transfers', 'preview', token] as const,
  },

  admin: {
    all: () => ['admin'] as const,
    users: {
      all: () => ['admin', 'users'] as const,
      lists: () => ['admin', 'users', 'list'] as const,
      list: (params: Record<string, unknown> = {}) =>
        ['admin', 'users', 'list', stableParams(params)] as const,
      details: () => ['admin', 'users', 'detail'] as const,
      detail: (id: string) => ['admin', 'users', 'detail', id] as const,
    },
    /** The organization's settings document (spec 06 §2). */
    settings: () => ['admin', 'settings'] as const,
    events: {
      all: () => ['admin', 'events'] as const,
      lists: () => ['admin', 'events', 'list'] as const,
      list: (params: Record<string, unknown> = {}) =>
        ['admin', 'events', 'list', stableParams(params)] as const,
    },
  },
} as const

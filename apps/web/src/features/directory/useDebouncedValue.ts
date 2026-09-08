import { useEffect, useState } from 'react'

/** How long the search field waits before asking the API (spec 08 §3). */
export const SEARCH_DEBOUNCE_MS = 300

/**
 * The value as it was `delay` milliseconds ago, once it has stopped changing.
 *
 * Search happens as the member types, but a request per keystroke would be one
 * per keystroke; holding the value back until typing pauses turns a word into a
 * single query, and the cache key follows the debounced value so a half-typed
 * search never becomes a cache entry of its own.
 */
export function useDebouncedValue<T>(value: T, delay: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}

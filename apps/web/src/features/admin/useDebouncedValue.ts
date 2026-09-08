import { useEffect, useState } from 'react'

/** How long a filter waits for the typing to stop before it becomes a request. */
export const FILTER_DEBOUNCE_MS = 250

/**
 * The value as it stands once it has held still.
 *
 * Filters on the admin screens are typed into, and every keystroke would
 * otherwise be a request and a cache entry of its own. Waiting a moment turns a
 * typed word into one query for the word.
 */
export function useDebouncedValue<Value>(value: Value, delay = FILTER_DEBOUNCE_MS): Value {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return settled
}

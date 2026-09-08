/**
 * Puts the color scheme on the document before React renders anything.
 *
 * Material UI ships `InitColorSchemeScript` for this, but it is built for
 * server rendering: it emits an inline `<script>` into the server's HTML and
 * returns `null` on every client render, so in an app that is rendered entirely
 * in the browser it does nothing. (An inline script would be refused here
 * anyway — the service serves `script-src 'self'` with no `unsafe-inline`,
 * spec 02 §7.) This is the same work done directly, from `main.tsx`, before the
 * root is created.
 *
 * It reads exactly what Material UI writes — the same `localStorage` keys, the
 * same `data-<scheme>` attribute that `colorSchemeSelector: 'data'` generates
 * selectors for — so a member who fixed the scheme on their last visit gets it
 * on the first paint of this one, rather than a flash of the other scheme while
 * `/me` is fetched.
 */

/** Material UI's default key for the mode (`system`, `light`, or `dark`). */
export const MODE_STORAGE_KEY = 'mui-mode'

/** Material UI's default key prefix for the scheme each mode maps to. */
export const COLOR_SCHEME_STORAGE_KEY = 'mui-color-scheme'

const LIGHT_SCHEME = 'light'
const DARK_SCHEME = 'dark'

/** Reading storage throws outright in a browser configured to refuse it. */
function storedValue(win: Window, key: string): string | null {
  try {
    return win.localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * Applies the stored color scheme, or the device's preference when the member
 * has not fixed one, to `<html>`.
 *
 * Safe to call anywhere: a window without `matchMedia` or `localStorage` falls
 * back to the light scheme rather than failing to start the app.
 */
export function initColorScheme(win: Window = window): void {
  const mode = storedValue(win, MODE_STORAGE_KEY) ?? 'system'
  const light = storedValue(win, `${COLOR_SCHEME_STORAGE_KEY}-light`) ?? LIGHT_SCHEME
  const dark = storedValue(win, `${COLOR_SCHEME_STORAGE_KEY}-dark`) ?? DARK_SCHEME

  let scheme = light
  if (mode === 'dark') {
    scheme = dark
  } else if (mode === 'system') {
    scheme = win.matchMedia?.('(prefers-color-scheme: dark)').matches === true ? dark : light
  }

  const root = win.document.documentElement
  root.removeAttribute(`data-${light}`)
  root.removeAttribute(`data-${dark}`)
  root.setAttribute(`data-${scheme}`, '')
}

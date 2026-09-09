/**
 * The app's own visual defaults: the bottom layer of the theme (ADR 0002 §11).
 *
 * Upstream owns these. A deployment that wants other values states them in
 * `overrides.ts`; nothing here is edited by a fork. They live apart from
 * `app/theme.ts` so that the build configuration can read the ground colors —
 * which `index.html` paints before any script has run — without pulling the
 * whole Material UI theme into it.
 */

/** The brand colors an organization gets before it sets its own. */
export const UPSTREAM_PRIMARY_COLOR = '#3b5bdb'
export const UPSTREAM_SECONDARY_COLOR = '#6d28d9'

/** The page ground in light, and the surface that sits on it. */
export const UPSTREAM_LIGHT_GROUND = '#f6f7fb'
export const UPSTREAM_LIGHT_SURFACE = '#ffffff'

/** The page ground in dark, and the surface that sits on it. */
export const UPSTREAM_DARK_GROUND = '#0b1020'
export const UPSTREAM_DARK_SURFACE = '#141a2e'

/** The interface typeface; `branding/fonts.ts` registers the family. */
export const UPSTREAM_FONT_UI =
  "'Manrope Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** For keywords, hosts, and anything typed exactly. */
export const UPSTREAM_FONT_MONO =
  "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace"

/** The base corner radius, in pixels. */
export const UPSTREAM_BORDER_RADIUS = 10

/** Spec 06 §2 writes every branding color as `#rrggbb`; deployment overrides are written the same way. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/**
 * A color, if the value given is one this app can use, and `undefined`
 * otherwise. A malformed color is dropped rather than allowed to break the
 * theme it would have gone into.
 */
export function hexColor(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return HEX_COLOR.test(trimmed) ? trimmed : undefined
}

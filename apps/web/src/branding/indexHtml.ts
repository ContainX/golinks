/**
 * The deployment's ground colors, painted into `index.html` at build time.
 *
 * `index.html` carries the page ground as an inline style, so that the first
 * frame is the right color before any script has evaluated (an inline script
 * would be refused by the service's Content-Security-Policy, spec 02 §7). That
 * style is written with the app's own grounds; a deployment that overrides
 * them in `branding/overrides.ts` needs its color there too, or the page
 * flashes the upstream ground and then repaints.
 *
 * The rewrite is a pure string transform, so it is tested directly; the plugin
 * around it only hands Vite the same function.
 */

import { hexColor, UPSTREAM_DARK_GROUND, UPSTREAM_LIGHT_GROUND } from './defaults.ts'
import type { BrandingOverrides } from './types.ts'

/** The one inline style block in the head, which is where the grounds are written. */
const HEAD_STYLE_BLOCK = /<style>[\s\S]*?<\/style>/

/** The grounds the served document is written with, as a single pass of alternatives. */
const UPSTREAM_GROUNDS = new RegExp(`${UPSTREAM_LIGHT_GROUND}|${UPSTREAM_DARK_GROUND}`, 'gi')

/**
 * Replaces the pre-paint ground colors in the served document with the
 * deployment's own. A deployment that overrides neither ground gets the
 * document back untouched.
 */
export function applyGroundColors(html: string, overrides: BrandingOverrides): string {
  const light = hexColor(overrides.light?.backgroundColor)
  const dark = hexColor(overrides.dark?.backgroundColor)

  if (light === undefined && dark === undefined) {
    return html
  }

  return html.replace(HEAD_STYLE_BLOCK, (style) =>
    // One pass over both grounds, so that a deployment whose light ground is
    // the app's dark one does not have it rewritten twice.
    style.replace(UPSTREAM_GROUNDS, (ground) =>
      ground.toLowerCase() === UPSTREAM_LIGHT_GROUND ? (light ?? ground) : (dark ?? ground),
    ),
  )
}

/** Hands the rewrite to Vite, for the dev server and the build alike. */
export function brandingIndexHtmlPlugin(overrides: BrandingOverrides) {
  return {
    name: 'golinks:branding-index-html',
    transformIndexHtml(html: string): string {
      return applyGroundColors(html, overrides)
    },
  }
}

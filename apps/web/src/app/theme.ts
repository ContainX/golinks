/**
 * The Material UI theme, in light and dark, derived from the organization's
 * branding (spec 06 §2, ADR 0002 §10).
 *
 * Two schemes are always built, so that every screen has somewhere to go when
 * the member's device — or the member — asks for dark. Both are derived from
 * the same two brand colors: the light scheme uses them as given, and the dark
 * scheme lightens them until they read against a dark surface, which is what
 * Material UI itself does with its own palette (`blue[700]` in light,
 * `blue[200]` in dark).
 *
 * `cssVariables.colorSchemeSelector: 'data'` puts both palettes on the page as
 * CSS custom properties and switches between them with a `data-light` or
 * `data-dark` attribute on `<html>`. Switching schemes is then an attribute
 * change rather than a re-render, and the attribute can be set before the
 * bundle has evaluated (see `initColorScheme.ts`), which is what keeps a member
 * who prefers dark from seeing a white page first.
 */

import type { OrganizationBranding } from '@golinks/shared/settings'
import type { Theme } from '@mui/material/styles'
import { createTheme, getContrastRatio, lighten } from '@mui/material/styles'

declare module '@mui/material/styles' {
  /**
   * Every theme in this app is built with `cssVariables`, which is what puts
   * `colorSchemes`, `colorSchemeSelector`, and `vars` on `Theme`. Material UI
   * keeps those off the type until an application says so, because they are
   * absent from a theme built without them.
   */
  interface CssThemeVariables {
    enabled: true
  }
}

/** Spec 06 §2 stores branding colors as `#rrggbb`. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** The surface Material UI paints behind everything in its dark palette. */
const DARK_SURFACE = '#121212'

/**
 * WCAG AA for large text and for the interactive elements a brand color is
 * used on: tabs, links, outlined buttons, the active state of a chip.
 */
const MIN_CONTRAST_ON_DARK = 4.5

/** How far one lightening step moves a color, and how many steps are allowed. */
const LIGHTEN_STEP = 0.08
const MAX_LIGHTEN_STEPS = 12

/**
 * A stored color that no longer parses (an older document, a hand-edited
 * settings row) must not take the whole app down, so an unusable value is
 * dropped and the palette default stands in.
 */
function paletteColor(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return HEX_COLOR.test(trimmed) ? trimmed : undefined
}

/**
 * The same brand color, lightened until it is legible on a dark surface.
 *
 * A brand color chosen for white paper is often too dark to read against
 * `#121212`; a navy that looks deliberate in light is nearly invisible in dark.
 * Lightening in small steps keeps the hue — the color is still recognizably
 * the organization's — while raising the contrast to the point where text and
 * borders drawn in it can be read. A color that already passes is left alone.
 */
export function colorForDarkScheme(color: string): string {
  let candidate = color
  for (let step = 0; step < MAX_LIGHTEN_STEPS; step += 1) {
    if (getContrastRatio(candidate, DARK_SURFACE) >= MIN_CONTRAST_ON_DARK) {
      return candidate
    }
    candidate = lighten(candidate, LIGHTEN_STEP)
  }
  return candidate
}

function schemePalette(
  primary: string | undefined,
  secondary: string | undefined,
): { primary?: { main: string }; secondary?: { main: string } } {
  return {
    ...(primary ? { primary: { main: primary } } : {}),
    ...(secondary ? { secondary: { main: secondary } } : {}),
  }
}

/**
 * Builds the Material UI theme for an organization from its branding
 * (spec 06 §2), as that branding arrives on the `Me` payload (spec 05 §2.2).
 *
 * Branding colors are used when present and well formed; anything missing falls
 * back to the Material UI default palette, in both schemes. Passing `null` or
 * `undefined` (the state before the organization's settings have loaded) yields
 * the default theme, so the same call works during bootstrap and after.
 */
export function createAppTheme(branding?: OrganizationBranding | null): Theme {
  const primary = paletteColor(branding?.primaryColor)
  const secondary = paletteColor(branding?.secondaryColor)

  return createTheme({
    cssVariables: { colorSchemeSelector: 'data' },
    colorSchemes: {
      light: { palette: { mode: 'light', ...schemePalette(primary, secondary) } },
      dark: {
        palette: {
          mode: 'dark',
          ...schemePalette(
            primary === undefined ? undefined : colorForDarkScheme(primary),
            secondary === undefined ? undefined : colorForDarkScheme(secondary),
          ),
        },
      },
    },
  })
}

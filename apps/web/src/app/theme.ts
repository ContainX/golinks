import type { OrganizationBranding } from '@golinks/shared/settings'
import type { Theme } from '@mui/material/styles'
import { createTheme } from '@mui/material/styles'

/** Spec 06 §2 stores branding colors as `#rrggbb`. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

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
 * Builds the Material UI theme for an organization from its branding
 * (spec 06 §2), as that branding arrives on the `Me` payload (spec 05 §2.2).
 *
 * Branding colors are used when present and well formed; anything missing falls
 * back to the Material UI default palette. Passing `null` or `undefined` (the
 * state before the organization's settings have loaded) yields the default
 * theme, so the same call works during bootstrap and after.
 */
export function createAppTheme(branding?: OrganizationBranding | null): Theme {
  const primary = paletteColor(branding?.primaryColor)
  const secondary = paletteColor(branding?.secondaryColor)

  return createTheme({
    palette: {
      ...(primary ? { primary: { main: primary } } : {}),
      ...(secondary ? { secondary: { main: secondary } } : {}),
    },
  })
}

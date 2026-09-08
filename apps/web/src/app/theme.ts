/**
 * The Material UI theme, in light and dark, derived from the organization's
 * branding (spec 06 §2, ADR 0002 §10).
 *
 * The visual direction is "quiet": white chrome with thin borders, the brand
 * color reserved for actions and the active state, Manrope for the interface
 * and JetBrains Mono for anything a member types (keywords, hosts), 10px
 * radii, bordered surfaces instead of shadows. Both fonts ship in the bundle,
 * because the service's Content-Security-Policy allows no third-party font
 * host on purpose.
 *
 * Two schemes are always built, so that every screen has somewhere to go when
 * the member's device — or the member — asks for dark. Both are derived from
 * the same two brand colors: the light scheme uses them as given, and the dark
 * scheme lightens them until they read against a dark surface.
 *
 * `cssVariables.colorSchemeSelector: 'data'` puts both palettes on the page as
 * CSS custom properties and switches between them with a `data-light` or
 * `data-dark` attribute on `<html>`, which can be set before the bundle has
 * evaluated (see `initColorScheme.ts`).
 */

import type { OrganizationBranding } from '@golinks/shared/settings'
import type { Theme } from '@mui/material/styles'
import { createTheme, getContrastRatio, lighten } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true
  }
}

/** The interface typeface; `@fontsource-variable/manrope` registers the family. */
export const FONT_UI = "'Manrope Variable', system-ui, -apple-system, 'Segoe UI', sans-serif"

/** For keywords, hosts, and anything typed exactly; `@fontsource-variable/jetbrains-mono`. */
export const FONT_MONO = "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, monospace"

/** The brand colors an organization gets before it sets its own. */
export const DEFAULT_PRIMARY_COLOR = '#3b5bdb'
export const DEFAULT_SECONDARY_COLOR = '#6d28d9'

/** Spec 06 §2 stores branding colors as `#rrggbb`. */
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** The page ground in dark; also painted by index.html before the bundle runs. */
export const DARK_GROUND = '#0b1020'
/** The page ground in light. */
export const LIGHT_GROUND = '#f6f7fb'

/** The surface the dark scheme is judged against for contrast. */
const DARK_SURFACE = '#141a2e'

/** WCAG AA for the interactive elements a brand color is used on. */
const MIN_CONTRAST_ON_DARK = 4.5
const LIGHTEN_STEP = 0.08
const MAX_LIGHTEN_STEPS = 12

function paletteColor(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return HEX_COLOR.test(trimmed) ? trimmed : undefined
}

/**
 * The same brand color, lightened until it is legible on a dark surface. A
 * color that already passes is left alone, so the hue stays recognizably the
 * organization's.
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

/**
 * Builds the theme for an organization from its branding (spec 06 §2), as it
 * arrives on the `Me` payload. Passing `null` or `undefined` (before the
 * organization's settings have loaded) yields the default theme, so the same
 * call works during bootstrap and after.
 */
export function createAppTheme(branding?: OrganizationBranding | null): Theme {
  const primary = paletteColor(branding?.primaryColor) ?? DEFAULT_PRIMARY_COLOR
  const secondary = paletteColor(branding?.secondaryColor) ?? DEFAULT_SECONDARY_COLOR

  return createTheme({
    cssVariables: { colorSchemeSelector: 'data' },
    colorSchemes: {
      light: {
        palette: {
          mode: 'light',
          primary: { main: primary },
          secondary: { main: secondary },
          background: { default: LIGHT_GROUND, paper: '#ffffff' },
          text: { primary: '#0f172a', secondary: '#5b6478', disabled: '#9aa3b5' },
          divider: '#e6e8ef',
          action: { hover: 'rgba(15, 23, 42, 0.04)', selected: 'rgba(59, 91, 219, 0.08)' },
        },
      },
      dark: {
        palette: {
          mode: 'dark',
          primary: { main: colorForDarkScheme(primary) },
          secondary: { main: colorForDarkScheme(secondary) },
          background: { default: DARK_GROUND, paper: DARK_SURFACE },
          text: { primary: '#e6e9f2', secondary: '#a3acc2', disabled: '#5f6982' },
          divider: '#273049',
          action: { hover: 'rgba(230, 233, 242, 0.06)', selected: 'rgba(230, 233, 242, 0.1)' },
        },
      },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: FONT_UI,
      h1: { fontWeight: 700, letterSpacing: '-0.02em' },
      h2: { fontWeight: 700, letterSpacing: '-0.02em' },
      h3: { fontWeight: 700, letterSpacing: '-0.02em' },
      h4: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '1.75rem' },
      h5: { fontWeight: 700, letterSpacing: '-0.02em', fontSize: '1.5rem' },
      h6: { fontWeight: 700, letterSpacing: '-0.01em', fontSize: '1.125rem' },
      subtitle1: { fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: 'none', fontWeight: 600, letterSpacing: 0 },
      overline: { fontWeight: 600, letterSpacing: '0.08em', fontSize: '0.6875rem' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          'code, kbd, samp, pre': { fontFamily: FONT_MONO },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { borderRadius: 8, paddingLeft: 14, paddingRight: 14 },
          sizeLarge: { paddingLeft: 18, paddingRight: 18 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: 10 },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 8,
            backgroundColor: theme.vars.palette.background.paper,
            '& .MuiOutlinedInput-notchedOutline': { borderColor: theme.vars.palette.divider },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.vars.palette.text.secondary,
            },
          }),
        },
      },
      MuiChip: {
        styleOverrides: {
          root: { fontWeight: 500 },
          outlined: ({ theme }) => ({ borderColor: theme.vars.palette.divider }),
        },
        variants: [
          {
            // A selected chip is a soft tint of the brand color, not a solid block of it.
            props: { variant: 'filled', color: 'primary' },
            style: ({ theme }) => ({
              backgroundColor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.12)`,
              color: theme.vars.palette.primary.main,
              '&.MuiChip-clickable:hover': {
                backgroundColor: `rgba(${theme.vars.palette.primary.mainChannel} / 0.2)`,
              },
            }),
          },
        ],
      },
      MuiTableCell: {
        styleOverrides: {
          root: ({ theme }) => ({ borderBottomColor: theme.vars.palette.divider }),
          head: ({ theme }) => ({
            fontSize: '0.6875rem',
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: theme.vars.palette.text.secondary,
            backgroundColor: theme.vars.palette.background.default,
          }),
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: ({ theme }) => ({
            '&.MuiTableRow-hover:hover': { backgroundColor: theme.vars.palette.action.hover },
          }),
        },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { borderRadius: 8, fontSize: '0.75rem' } },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: 10 } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: 14 } },
      },
      MuiMenu: {
        styleOverrides: {
          paper: ({ theme }) => ({
            borderRadius: 10,
            border: `1px solid ${theme.vars.palette.divider}`,
            boxShadow: '0 12px 32px -12px rgba(15, 23, 42, 0.25)',
          }),
        },
      },
      MuiAvatar: {
        styleOverrides: { root: { fontWeight: 700, fontSize: '0.75rem' } },
      },
      MuiTabs: {
        styleOverrides: { indicator: { height: 2 } },
      },
      MuiTab: {
        styleOverrides: { root: { fontWeight: 600, minHeight: 44 } },
      },
    },
  })
}

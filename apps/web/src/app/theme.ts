/**
 * The Material UI theme, in light and dark, derived from the organization's
 * branding (spec 06 §2, ADR 0002 §11).
 *
 * The visual direction is "quiet": white chrome with thin borders, the brand
 * color reserved for actions and the active state, Manrope for the interface
 * and JetBrains Mono for anything a member types (keywords, hosts), 10px
 * radii, bordered surfaces instead of shadows. The typefaces and the radius
 * are what a deployment gets before it states its own (`branding/overrides.ts`);
 * whichever fonts are named, they ship in the bundle from `branding/fonts.ts`,
 * because the service's Content-Security-Policy allows no third-party font
 * host on purpose.
 *
 * Two schemes are always built, so that every screen has somewhere to go when
 * the member's device — or the member — asks for dark. Each color is settled
 * in four layers, the first of them that has a value winning:
 *
 * 1. the organization's color for that scheme (`branding.dark.primaryColor`),
 *    taken as written, because it was chosen for that scheme;
 * 2. the organization's scheme-independent brand color, lightened in dark
 *    until it reads against the dark surface actually in use;
 * 3. the deployment's own color for that scheme (`branding/overrides.ts`);
 * 4. the app's default, lightened for dark the same way.
 *
 * `cssVariables.colorSchemeSelector: 'data'` puts both palettes on the page as
 * CSS custom properties and switches between them with a `data-light` or
 * `data-dark` attribute on `<html>`, which can be set before the bundle has
 * evaluated (see `initColorScheme.ts`).
 */

import type { OrganizationBranding } from '@golinks/shared/settings'
import type { Theme } from '@mui/material/styles'
import { alpha, createTheme, getContrastRatio, lighten } from '@mui/material/styles'
import {
  hexColor,
  UPSTREAM_BORDER_RADIUS,
  UPSTREAM_DARK_GROUND,
  UPSTREAM_DARK_SURFACE,
  UPSTREAM_FONT_MONO,
  UPSTREAM_FONT_UI,
  UPSTREAM_LIGHT_GROUND,
  UPSTREAM_LIGHT_SURFACE,
  UPSTREAM_PRIMARY_COLOR,
  UPSTREAM_SECONDARY_COLOR,
} from '../branding/defaults.ts'
import { brandingOverrides } from '../branding/overrides.ts'
import type { SchemeOverrides } from '../branding/types.ts'

declare module '@mui/material/styles' {
  interface CssThemeVariables {
    enabled: true
  }
}

/** One of the two color schemes. */
type SchemeName = 'light' | 'dark'

/** A color this deployment fixed for one scheme, if it set a usable one. */
function forkColor(scheme: SchemeName, key: keyof SchemeOverrides): string | undefined {
  return hexColor(brandingOverrides[scheme]?.[key])
}

/** The interface typeface; `branding/fonts.ts` registers the family. */
export const FONT_UI = brandingOverrides.fonts?.ui ?? UPSTREAM_FONT_UI

/** For keywords, hosts, and anything typed exactly. */
export const FONT_MONO = brandingOverrides.fonts?.mono ?? UPSTREAM_FONT_MONO

/** The brand colors an organization gets before it sets its own. */
export const DEFAULT_PRIMARY_COLOR = forkColor('light', 'primaryColor') ?? UPSTREAM_PRIMARY_COLOR
export const DEFAULT_SECONDARY_COLOR =
  forkColor('light', 'secondaryColor') ?? UPSTREAM_SECONDARY_COLOR

/** The page ground in light; also painted by index.html before the bundle runs. */
export const LIGHT_GROUND = forkColor('light', 'backgroundColor') ?? UPSTREAM_LIGHT_GROUND
/** The surface cards, tables, and dialogs sit on in light. */
export const LIGHT_SURFACE = forkColor('light', 'surfaceColor') ?? UPSTREAM_LIGHT_SURFACE

/** The page ground in dark; also painted by index.html before the bundle runs. */
export const DARK_GROUND = forkColor('dark', 'backgroundColor') ?? UPSTREAM_DARK_GROUND
/** The surface the dark scheme is judged against for contrast. */
export const DARK_SURFACE = forkColor('dark', 'surfaceColor') ?? UPSTREAM_DARK_SURFACE

/** The base corner radius; buttons and inputs sit tighter, dialogs looser. */
export const BORDER_RADIUS = brandingOverrides.borderRadius ?? UPSTREAM_BORDER_RADIUS
const RADIUS_TIGHT = Math.max(0, BORDER_RADIUS - 2)
const RADIUS_LOOSE = BORDER_RADIUS + 4

/** WCAG AA for the interactive elements a brand color is used on. */
const MIN_CONTRAST_ON_DARK = 4.5
const LIGHTEN_STEP = 0.08
const MAX_LIGHTEN_STEPS = 12

/**
 * The same brand color, lightened until it is legible on the dark scheme's
 * surface — the organization's own surface color when it set one, so that a
 * deployment or an organization that darkens or lightens the surface gets a
 * brand color judged against the surface members actually see. A color that
 * already passes is left alone, so the hue stays recognizably the
 * organization's.
 */
export function colorForDarkScheme(color: string, surface: string = DARK_SURFACE): string {
  let candidate = color
  for (let step = 0; step < MAX_LIGHTEN_STEPS; step += 1) {
    if (getContrastRatio(candidate, surface) >= MIN_CONTRAST_ON_DARK) {
      return candidate
    }
    candidate = lighten(candidate, LIGHTEN_STEP)
  }
  return candidate
}

/**
 * One brand color for one scheme, settled through the four layers described
 * above. `lift` is what dark does to a color that was not chosen for it.
 */
function brandColor(
  branding: OrganizationBranding | null | undefined,
  scheme: SchemeName,
  key: 'primaryColor' | 'secondaryColor',
  darkSurface: string,
): string {
  const lift = (color: string): string =>
    scheme === 'dark' ? colorForDarkScheme(color, darkSurface) : color

  const chosenForScheme = hexColor(branding?.[scheme]?.[key])
  if (chosenForScheme !== undefined) {
    return chosenForScheme
  }

  const shared = hexColor(branding?.[key])
  if (shared !== undefined) {
    return lift(shared)
  }

  const deployment = forkColor(scheme, key)
  if (deployment !== undefined) {
    return deployment
  }

  return lift(key === 'primaryColor' ? DEFAULT_PRIMARY_COLOR : DEFAULT_SECONDARY_COLOR)
}

/**
 * The ground or the surface of one scheme. Neither has a scheme-independent
 * form in the settings document, so the organization's value is the only layer
 * above the deployment's own, which the constants already carry.
 */
function groundColor(
  branding: OrganizationBranding | null | undefined,
  scheme: SchemeName,
  key: 'backgroundColor' | 'surfaceColor',
  fallback: string,
): string {
  return hexColor(branding?.[scheme]?.[key]) ?? fallback
}

/**
 * Builds the theme for an organization from its branding (spec 06 §2), as it
 * arrives on the `Me` payload. Passing `null` or `undefined` (before the
 * organization's settings have loaded) yields the default theme, so the same
 * call works during bootstrap and after.
 */
export function createAppTheme(branding?: OrganizationBranding | null): Theme {
  // Settled first: the brand colors of the dark scheme are judged against it.
  const darkSurface = groundColor(branding, 'dark', 'surfaceColor', DARK_SURFACE)

  const lightPrimary = brandColor(branding, 'light', 'primaryColor', darkSurface)
  const lightSecondary = brandColor(branding, 'light', 'secondaryColor', darkSurface)
  const darkPrimary = brandColor(branding, 'dark', 'primaryColor', darkSurface)
  const darkSecondary = brandColor(branding, 'dark', 'secondaryColor', darkSurface)

  return createTheme({
    cssVariables: { colorSchemeSelector: 'data' },
    colorSchemes: {
      light: {
        palette: {
          mode: 'light',
          primary: { main: lightPrimary },
          secondary: { main: lightSecondary },
          background: {
            default: groundColor(branding, 'light', 'backgroundColor', LIGHT_GROUND),
            paper: groundColor(branding, 'light', 'surfaceColor', LIGHT_SURFACE),
          },
          text: { primary: '#0f172a', secondary: '#5b6478', disabled: '#9aa3b5' },
          divider: '#e6e8ef',
          action: {
            hover: 'rgba(15, 23, 42, 0.04)',
            // The active state is the brand color, whichever one that is.
            selected: alpha(lightPrimary, 0.08),
          },
        },
      },
      dark: {
        palette: {
          mode: 'dark',
          primary: { main: darkPrimary },
          secondary: { main: darkSecondary },
          background: {
            default: groundColor(branding, 'dark', 'backgroundColor', DARK_GROUND),
            paper: darkSurface,
          },
          text: { primary: '#e6e9f2', secondary: '#a3acc2', disabled: '#5f6982' },
          divider: '#273049',
          action: { hover: 'rgba(230, 233, 242, 0.06)', selected: 'rgba(230, 233, 242, 0.1)' },
        },
      },
    },
    shape: { borderRadius: BORDER_RADIUS },
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
          root: { borderRadius: RADIUS_TIGHT, paddingLeft: 14, paddingRight: 14 },
          sizeLarge: { paddingLeft: 18, paddingRight: 18 },
        },
      },
      MuiPaper: {
        styleOverrides: {
          rounded: { borderRadius: BORDER_RADIUS },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: RADIUS_TIGHT,
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
        styleOverrides: { tooltip: { borderRadius: RADIUS_TIGHT, fontSize: '0.75rem' } },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: BORDER_RADIUS } },
      },
      MuiDialog: {
        styleOverrides: { paper: { borderRadius: RADIUS_LOOSE } },
      },
      MuiMenu: {
        styleOverrides: {
          paper: ({ theme }) => ({
            borderRadius: BORDER_RADIUS,
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

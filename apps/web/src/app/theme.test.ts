import type { OrganizationBranding } from '@golinks/shared/settings'
import { DEFAULT_BRANDING_TITLE } from '@golinks/shared/settings'
import { getContrastRatio } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import {
  colorForDarkScheme,
  createAppTheme,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
} from './theme.ts'

/** Branding as the shared schema fills it in for an organization that set none. */
const noBranding: OrganizationBranding = {
  title: DEFAULT_BRANDING_TITLE,
  logoUrl: null,
  faviconUrl: null,
  primaryColor: null,
  secondaryColor: null,
}

describe('createAppTheme', () => {
  it('uses the branding colors when the organization has set them', () => {
    const theme = createAppTheme({
      ...noBranding,
      title: 'Acme GoLinks',
      primaryColor: '#1f4b99',
      secondaryColor: '#d97706',
    })

    expect(theme.palette.primary.main).toBe('#1f4b99')
    expect(theme.palette.secondary.main).toBe('#d97706')
  })

  it('falls back to the default palette when branding sets no colors', () => {
    const theme = createAppTheme(noBranding)

    expect(theme.palette.primary.main).toBe(DEFAULT_PRIMARY_COLOR)
    expect(theme.palette.secondary.main).toBe(DEFAULT_SECONDARY_COLOR)
  })

  it('uses one branding color without disturbing the other', () => {
    const theme = createAppTheme({ ...noBranding, primaryColor: '#1f4b99' })

    expect(theme.palette.primary.main).toBe('#1f4b99')
    expect(theme.palette.secondary.main).toBe(DEFAULT_SECONDARY_COLOR)
  })

  it('builds the default theme when no branding has loaded yet', () => {
    for (const branding of [undefined, null]) {
      const theme = createAppTheme(branding)
      expect(theme.palette.primary.main).toBe(DEFAULT_PRIMARY_COLOR)
      expect(theme.palette.secondary.main).toBe(DEFAULT_SECONDARY_COLOR)
    }
  })

  it('ignores a color that is not #rrggbb rather than failing to build a theme', () => {
    const theme = createAppTheme({
      ...noBranding,
      primaryColor: 'rebeccapurple',
      secondaryColor: '#abc',
    })

    expect(theme.palette.primary.main).toBe(DEFAULT_PRIMARY_COLOR)
    expect(theme.palette.secondary.main).toBe(DEFAULT_SECONDARY_COLOR)
  })
})

describe('colorForDarkScheme', () => {
  const DARK_SURFACE = '#121212'

  it('lightens a brand color until it can be read on a dark surface', () => {
    const navy = '#1f4b99'
    expect(getContrastRatio(navy, DARK_SURFACE)).toBeLessThan(4.5)

    expect(getContrastRatio(colorForDarkScheme(navy), DARK_SURFACE)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves a color that already reads on a dark surface alone', () => {
    const amber = '#d97706'
    expect(getContrastRatio(amber, DARK_SURFACE)).toBeGreaterThanOrEqual(4.5)

    expect(colorForDarkScheme(amber)).toBe(amber)
  })
})

describe('createAppTheme color schemes', () => {
  it('builds a light and a dark scheme, selected by a data attribute (ADR 0002 §10)', () => {
    const theme = createAppTheme(noBranding)

    expect(theme.colorSchemes.light).toBeDefined()
    expect(theme.colorSchemes.dark).toBeDefined()
    expect(theme.colorSchemeSelector).toBe('data')
    // Both palettes are on the page at once, as custom properties, so that
    // switching schemes is an attribute change rather than a re-render.
    expect(theme.vars).toBeDefined()
  })

  it('derives both schemes from the same branding colors', () => {
    const theme = createAppTheme({
      ...noBranding,
      primaryColor: '#1f4b99',
      secondaryColor: '#d97706',
    })

    expect(theme.colorSchemes.light?.palette.primary.main).toBe('#1f4b99')
    expect(theme.colorSchemes.light?.palette.secondary.main).toBe('#d97706')
    expect(theme.colorSchemes.dark?.palette.primary.main).toBe(colorForDarkScheme('#1f4b99'))
    expect(theme.colorSchemes.dark?.palette.secondary.main).toBe('#d97706')
  })

  it('gives the dark scheme its own defaults when branding sets no colors', () => {
    const theme = createAppTheme(noBranding)

    // The default brand color, lifted until it reads on the dark surface.
    expect(theme.colorSchemes.dark?.palette.primary.main).toBe(
      colorForDarkScheme(DEFAULT_PRIMARY_COLOR),
    )
    expect(theme.colorSchemes.dark?.palette.mode).toBe('dark')
  })
})

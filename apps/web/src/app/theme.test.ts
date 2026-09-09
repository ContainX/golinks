import type { BrandingSchemeColors } from '@golinks/shared/settings'
import { getContrastRatio } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrandingOverrides } from '../branding/types.ts'
import { brandingFixture } from '../test/fixtures.ts'
import {
  colorForDarkScheme,
  createAppTheme,
  DARK_GROUND,
  DARK_SURFACE,
  DEFAULT_PRIMARY_COLOR,
  DEFAULT_SECONDARY_COLOR,
  LIGHT_GROUND,
} from './theme.ts'

/**
 * The deployment's own defaults, as `branding/overrides.ts` states them. The
 * module is mocked for the whole file and starts empty, so every test above
 * the last describe sees the app's own values; the tests that care re-import
 * the theme with other overrides in place.
 */
const deployment = vi.hoisted(() => ({ overrides: {} as BrandingOverrides }))

vi.mock('../branding/overrides.ts', () => ({
  get brandingOverrides() {
    return deployment.overrides
  },
}))

/** Rebuilds the theme module on top of a deployment's overrides. */
async function themeWith(overrides: BrandingOverrides) {
  deployment.overrides = overrides
  vi.resetModules()
  return await import('./theme.ts')
}

afterEach(() => {
  deployment.overrides = {}
  vi.resetModules()
})

/** One scheme's colors, with everything unset unless the test names it. */
function scheme(colors: Partial<BrandingSchemeColors> = {}): BrandingSchemeColors {
  return {
    primaryColor: null,
    secondaryColor: null,
    backgroundColor: null,
    surfaceColor: null,
    ...colors,
  }
}

describe('createAppTheme', () => {
  it('uses the branding colors when the organization has set them', () => {
    const theme = createAppTheme(
      brandingFixture({
        title: 'Acme GoLinks',
        primaryColor: '#1f4b99',
        secondaryColor: '#d97706',
      }),
    )

    expect(theme.palette.primary.main).toBe('#1f4b99')
    expect(theme.palette.secondary.main).toBe('#d97706')
  })

  it('falls back to the default palette when branding sets no colors', () => {
    const theme = createAppTheme(brandingFixture())

    expect(theme.palette.primary.main).toBe(DEFAULT_PRIMARY_COLOR)
    expect(theme.palette.secondary.main).toBe(DEFAULT_SECONDARY_COLOR)
  })

  it('uses one branding color without disturbing the other', () => {
    const theme = createAppTheme(brandingFixture({ primaryColor: '#1f4b99' }))

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
    const theme = createAppTheme(
      brandingFixture({ primaryColor: 'rebeccapurple', secondaryColor: '#abc' }),
    )

    expect(theme.palette.primary.main).toBe(DEFAULT_PRIMARY_COLOR)
    expect(theme.palette.secondary.main).toBe(DEFAULT_SECONDARY_COLOR)
  })
})

describe('colorForDarkScheme', () => {
  const SURFACE = '#121212'

  it('lightens a brand color until it can be read on a dark surface', () => {
    const navy = '#1f4b99'
    expect(getContrastRatio(navy, SURFACE)).toBeLessThan(4.5)

    expect(getContrastRatio(colorForDarkScheme(navy, SURFACE), SURFACE)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves a color that already reads on a dark surface alone', () => {
    const amber = '#d97706'
    expect(getContrastRatio(amber, SURFACE)).toBeGreaterThanOrEqual(4.5)

    expect(colorForDarkScheme(amber, SURFACE)).toBe(amber)
  })

  it('judges against the app’s dark surface when no other one is given', () => {
    expect(colorForDarkScheme('#1f4b99')).toBe(colorForDarkScheme('#1f4b99', DARK_SURFACE))
  })
})

describe('createAppTheme color schemes', () => {
  it('builds a light and a dark scheme, selected by a data attribute (ADR 0002 §10)', () => {
    const theme = createAppTheme(brandingFixture())

    expect(theme.colorSchemes.light).toBeDefined()
    expect(theme.colorSchemes.dark).toBeDefined()
    expect(theme.colorSchemeSelector).toBe('data')
    // Both palettes are on the page at once, as custom properties, so that
    // switching schemes is an attribute change rather than a re-render.
    expect(theme.vars).toBeDefined()
  })

  it('derives both schemes from the same branding colors', () => {
    const theme = createAppTheme(
      brandingFixture({ primaryColor: '#1f4b99', secondaryColor: '#d97706' }),
    )

    expect(theme.colorSchemes.light?.palette.primary.main).toBe('#1f4b99')
    expect(theme.colorSchemes.light?.palette.secondary.main).toBe('#d97706')
    expect(theme.colorSchemes.dark?.palette.primary.main).toBe(colorForDarkScheme('#1f4b99'))
    expect(theme.colorSchemes.dark?.palette.secondary.main).toBe('#d97706')
  })

  it('gives the dark scheme its own defaults when branding sets no colors', () => {
    const theme = createAppTheme(brandingFixture())

    // The default brand color, lifted until it reads on the dark surface.
    expect(theme.colorSchemes.dark?.palette.primary.main).toBe(
      colorForDarkScheme(DEFAULT_PRIMARY_COLOR),
    )
    expect(theme.colorSchemes.dark?.palette.mode).toBe('dark')
  })
})

describe('a color set for one scheme', () => {
  it('beats the shared brand color, and is taken as written', () => {
    const theme = createAppTheme(
      brandingFixture({
        primaryColor: '#1f4b99',
        light: scheme({ primaryColor: '#7c2d12' }),
        dark: scheme({ primaryColor: '#1f4b99' }),
      }),
    )

    expect(theme.colorSchemes.light?.palette.primary.main).toBe('#7c2d12')
    // Chosen for the dark scheme, so it is not lightened on its way in.
    expect(theme.colorSchemes.dark?.palette.primary.main).toBe('#1f4b99')
  })

  it('leaves the other scheme on the shared color', () => {
    const theme = createAppTheme(
      brandingFixture({ primaryColor: '#1f4b99', dark: scheme({ primaryColor: '#f59e0b' }) }),
    )

    expect(theme.colorSchemes.light?.palette.primary.main).toBe('#1f4b99')
    expect(theme.colorSchemes.dark?.palette.primary.main).toBe('#f59e0b')
  })

  it('paints the ground and the surface of that scheme', () => {
    const theme = createAppTheme(
      brandingFixture({
        light: scheme({ backgroundColor: '#fdfbf7', surfaceColor: '#fffefb' }),
        dark: scheme({ backgroundColor: '#04110f', surfaceColor: '#0b1f1c' }),
      }),
    )

    expect(theme.colorSchemes.light?.palette.background.default).toBe('#fdfbf7')
    expect(theme.colorSchemes.light?.palette.background.paper).toBe('#fffefb')
    expect(theme.colorSchemes.dark?.palette.background.default).toBe('#04110f')
    expect(theme.colorSchemes.dark?.palette.background.paper).toBe('#0b1f1c')
  })

  it('keeps the app’s grounds for a scheme that sets none', () => {
    const theme = createAppTheme(brandingFixture())

    expect(theme.colorSchemes.light?.palette.background.default).toBe(LIGHT_GROUND)
    expect(theme.colorSchemes.dark?.palette.background.default).toBe(DARK_GROUND)
    expect(theme.colorSchemes.dark?.palette.background.paper).toBe(DARK_SURFACE)
  })

  it('lightens the shared brand color against the dark surface actually in use', () => {
    const surface = '#2b2b2b'
    const theme = createAppTheme(
      brandingFixture({ primaryColor: '#1f4b99', dark: scheme({ surfaceColor: surface }) }),
    )
    const darkPrimary = theme.colorSchemes.dark?.palette.primary.main ?? ''

    expect(getContrastRatio(darkPrimary, surface)).toBeGreaterThanOrEqual(4.5)
    // A lighter surface needs more lifting than the app's own dark surface would.
    expect(darkPrimary).not.toBe(colorForDarkScheme('#1f4b99'))
  })
})

describe('the deployment’s own defaults', () => {
  it('sits under the organization branding and over the app’s palette', async () => {
    const theme = await themeWith({
      light: { primaryColor: '#0f766e', backgroundColor: '#fdfbf7', surfaceColor: '#fffefb' },
      dark: { primaryColor: '#5eead4', backgroundColor: '#04110f', surfaceColor: '#0b1f1c' },
    })

    const unbranded = theme.createAppTheme(brandingFixture())
    expect(theme.DEFAULT_PRIMARY_COLOR).toBe('#0f766e')
    expect(theme.LIGHT_GROUND).toBe('#fdfbf7')
    expect(theme.DARK_GROUND).toBe('#04110f')
    expect(theme.DARK_SURFACE).toBe('#0b1f1c')
    expect(unbranded.colorSchemes.light?.palette.primary.main).toBe('#0f766e')
    expect(unbranded.colorSchemes.light?.palette.background.default).toBe('#fdfbf7')
    expect(unbranded.colorSchemes.light?.palette.background.paper).toBe('#fffefb')
    expect(unbranded.colorSchemes.dark?.palette.primary.main).toBe('#5eead4')
    expect(unbranded.colorSchemes.dark?.palette.background.default).toBe('#04110f')
    expect(unbranded.colorSchemes.dark?.palette.background.paper).toBe('#0b1f1c')

    const branded = theme.createAppTheme(
      brandingFixture({
        primaryColor: '#1f4b99',
        light: scheme({ backgroundColor: '#ffffff' }),
      }),
    )
    expect(branded.colorSchemes.light?.palette.primary.main).toBe('#1f4b99')
    expect(branded.colorSchemes.light?.palette.background.default).toBe('#ffffff')
  })

  it('lifts its light brand color into dark when it fixes no dark one', async () => {
    const theme = await themeWith({ light: { primaryColor: '#1f4b99' } })

    const built = theme.createAppTheme(brandingFixture())
    expect(built.colorSchemes.dark?.palette.primary.main).toBe(theme.colorForDarkScheme('#1f4b99'))
  })

  it('takes the typefaces and the corner radius from the deployment', async () => {
    const theme = await themeWith({
      fonts: { ui: "'Fork Sans', sans-serif", mono: "'Fork Mono', monospace" },
      borderRadius: 2,
    })

    const built = theme.createAppTheme(brandingFixture())
    expect(theme.FONT_UI).toBe("'Fork Sans', sans-serif")
    expect(theme.FONT_MONO).toBe("'Fork Mono', monospace")
    expect(built.typography.fontFamily).toBe("'Fork Sans', sans-serif")
    expect(built.shape.borderRadius).toBe(2)
  })

  it('ignores a color it cannot use', async () => {
    const theme = await themeWith({ light: { primaryColor: 'teal' } })

    expect(theme.DEFAULT_PRIMARY_COLOR).toBe(DEFAULT_PRIMARY_COLOR)
  })
})

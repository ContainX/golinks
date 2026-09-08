import type { OrganizationBranding } from '@golinks/shared/settings'
import { DEFAULT_BRANDING_TITLE } from '@golinks/shared/settings'
import { createTheme } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import { createAppTheme } from './theme.ts'

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
    const defaults = createTheme()
    const theme = createAppTheme(noBranding)

    expect(theme.palette.primary.main).toBe(defaults.palette.primary.main)
    expect(theme.palette.secondary.main).toBe(defaults.palette.secondary.main)
  })

  it('uses one branding color without disturbing the other', () => {
    const defaults = createTheme()
    const theme = createAppTheme({ ...noBranding, primaryColor: '#1f4b99' })

    expect(theme.palette.primary.main).toBe('#1f4b99')
    expect(theme.palette.secondary.main).toBe(defaults.palette.secondary.main)
  })

  it('builds the default theme when no branding has loaded yet', () => {
    const defaults = createTheme()

    for (const branding of [undefined, null]) {
      const theme = createAppTheme(branding)
      expect(theme.palette.primary.main).toBe(defaults.palette.primary.main)
      expect(theme.palette.secondary.main).toBe(defaults.palette.secondary.main)
    }
  })

  it('ignores a color that is not #rrggbb rather than failing to build a theme', () => {
    const defaults = createTheme()
    const theme = createAppTheme({
      ...noBranding,
      primaryColor: 'rebeccapurple',
      secondaryColor: '#abc',
    })

    expect(theme.palette.primary.main).toBe(defaults.palette.primary.main)
    expect(theme.palette.secondary.main).toBe(defaults.palette.secondary.main)
  })
})

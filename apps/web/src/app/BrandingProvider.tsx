/**
 * The organization's branding, applied at runtime (spec 08 §1).
 *
 * Everything an organization can brand — colors, title, icon, logo — arrives on
 * the `Me` payload (spec 05 §2.2) and is stored in its settings document
 * (spec 06 §2). None of it is built in: an admin who changes the primary color
 * changes what every member's next render looks like, with no rebuild and no
 * reload beyond rereading `/me`.
 *
 * Until that request has answered, and if it fails, the app renders in the
 * stock Material UI palette under the title `index.html` was served with. A
 * failure here is not shown: the commonest one by far is the 401 that has
 * already sent the browser to sign-in (spec 02 §2), and a member on their way
 * out should not be handed an error about a logo.
 *
 * The theme carries a light and a dark scheme (ADR 0002 §10); which one is on
 * the page is Material UI's business from here, driven by the device or by the
 * member's stored preference, which the shell applies.
 */

import type { OrganizationBranding } from '@golinks/shared/settings'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { useMe } from '../queries/me.ts'
import type { DocumentBrandingDefaults } from './documentBranding.ts'
import { applyDocumentBranding, readDocumentBrandingDefaults } from './documentBranding.ts'
import { createAppTheme } from './theme.ts'

/** `null` while the organization's settings are still on their way. */
const BrandingContext = createContext<OrganizationBranding | null>(null)

/**
 * The organization's branding, for the components that show it: the header
 * logo, the product name in the shell, anything else spelled by settings.
 * `null` until `/me` has answered.
 */
export function useBranding(): OrganizationBranding | null {
  return useContext(BrandingContext)
}

export interface BrandingProviderProps {
  children: ReactNode
}

/**
 * Reads the session, derives the theme from its branding, and keeps the
 * document's title and icon in step with it.
 */
export function BrandingProvider({ children }: BrandingProviderProps) {
  const { data } = useMe()
  const branding = data?.organization.branding ?? null

  const theme = useMemo(() => createAppTheme(branding), [branding])

  // Captured on the first render, before anything has been applied, so that
  // clearing a branding field restores the served title and icon.
  const defaults = useRef<DocumentBrandingDefaults>(null)
  defaults.current ??= readDocumentBrandingDefaults(document)
  const servedDefaults = defaults.current

  useEffect(() => {
    applyDocumentBranding(branding, servedDefaults, document)
  }, [branding, servedDefaults])

  return (
    <BrandingContext.Provider value={branding}>
      <ThemeProvider
        theme={theme}
        // Follow the device unless the member has fixed a scheme (ADR 0002 §10).
        defaultMode="system"
        // Nothing here is server-rendered, so the stored scheme can be read on
        // the very first render rather than in an effect after it: the page is
        // painted once, in the right scheme, instead of twice.
        noSsr
        disableTransitionOnChange
      >
        <CssBaseline />
        {children}
      </ThemeProvider>
    </BrandingContext.Provider>
  )
}

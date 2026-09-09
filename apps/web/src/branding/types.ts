/**
 * The shape of a deployment's own visual defaults (spec 08 §1).
 *
 * Upstream owns this file; a fork states its values in `overrides.ts` next to
 * it. Everything here is optional, and everything left out keeps the app's own
 * default, so a fork writes only the handful of lines it cares about and never
 * has to merge a change to the rest.
 *
 * These values sit *under* the organization settings document: an admin who
 * sets a branding color still wins over them. They are what an organization
 * that has set nothing gets to see.
 */

/** The colors of one color scheme, written as `#rrggbb`, as the settings document writes them. */
export interface SchemeOverrides {
  /** The brand color for actions and the active state. */
  primaryColor?: string
  secondaryColor?: string
  /** The page ground. */
  backgroundColor?: string
  /** The surface cards, tables, and dialogs sit on. */
  surfaceColor?: string
}

/** A deployment's visual defaults: colors per scheme, the two typefaces, the corner radius. */
export interface BrandingOverrides {
  light?: SchemeOverrides
  dark?: SchemeOverrides
  /**
   * CSS font stacks. The families named here must be loaded by `fonts.ts`,
   * because the service's Content-Security-Policy allows no third-party font
   * host: a family that is not in the bundle simply will not render.
   */
  fonts?: {
    ui?: string
    mono?: string
  }
  /** The base corner radius in pixels. Buttons and inputs sit 2px tighter, dialogs 4px looser. */
  borderRadius?: number
}

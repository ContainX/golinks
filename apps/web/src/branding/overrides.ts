/**
 * This file belongs to the deployment.
 *
 * Upstream ships it empty and never changes it again, so a fork can state its
 * own colors, typefaces, and corner radius here and still take every upstream
 * change without a conflict. `types.ts` beside it documents what may be set;
 * anything left out keeps the app's own default, and an organization's own
 * branding settings still win over everything written here.
 *
 * Keep this file free of side effects: the build configuration imports it to
 * paint the first frame of `index.html`, long before the app is running. Font
 * files are loaded from `fonts.ts`, not from here.
 */

import type { BrandingOverrides } from './types.ts'

export const brandingOverrides: BrandingOverrides = {}

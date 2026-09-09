/**
 * This file belongs to the deployment.
 *
 * It loads the typefaces the app renders in. A fork that wants other fonts
 * changes the imports here and names the families in `overrides.ts`; nothing
 * else in the app has to be touched, and upstream never changes this file.
 *
 * The fonts are bundled rather than fetched, because the service's
 * Content-Security-Policy allows no third-party font host (spec 02 §7).
 */

import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/manrope'
